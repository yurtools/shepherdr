//! Tests in TextViewState's private scope, using the real async parser.
use super::*;
use crate::text::format::markdown::reference_images_tests::images;

fn options(text: &str, append: bool, revision: usize) -> UpdateOptions {
    UpdateOptions {
        revision,
        pending_text: text.into(),
        append,
        mode: ParseMode::Replace,
        markdown_extensions: Default::default(),
    }
}

#[test]
fn appended_definitions_resolve_retained_references_and_later_uses() {
    let first = "![logo][pic]\n\nRetained paragraph\n\nTail";
    let initial = parse_content(
        TextViewFormat::Markdown,
        ParsedContent::default(),
        &options(first, false, 1),
    )
    .unwrap();
    assert!(images(&initial.document.blocks).is_empty());
    let delta = "\n\n[pic]: https://images.example/a.png \"title\"";
    let appended =
        parse_content(TextViewFormat::Markdown, initial, &options(delta, true, 2)).unwrap();
    assert_eq!(images(&appended.document.blocks).len(), 1);
    assert_eq!(appended.node_cx.link_refs.len(), 1);
    let next = parse_content(
        TextViewFormat::Markdown,
        appended,
        &options("\n\nLater ![logo][pic]", true, 3),
    )
    .unwrap();
    assert_eq!(images(&next.document.blocks).len(), 2);
    assert_eq!(
        next.document.source.as_ref(),
        format!("{first}{delta}\n\nLater ![logo][pic]")
    );
    // An appended duplicate cannot silently retarget earlier images or links.
    let next = parse_content(
        TextViewFormat::Markdown,
        next,
        &options("\n\n[PIC]: https://images.example/b.png", true, 4),
    )
    .unwrap();
    assert!(
        images(&next.document.blocks)
            .iter()
            .all(|i| i.url.as_ref() == "https://images.example/a.png")
    );
}

#[gpui::test]
fn replacements_and_stale_results_keep_only_current_image_definitions(
    cx: &mut gpui::TestAppContext,
) {
    cx.update(crate::init);
    let a = "![logo][pic]\n\n[pic]: https://images.example/a.png";
    let b = a.replace("a.png", "b.png");
    assert_eq!(a.len(), b.len());
    let state = cx.update(|cx| cx.new(|cx| TextViewState::markdown(a, cx)));
    state.update(cx, |state, cx| state.set_text(&b, cx));
    cx.run_until_parked();
    state.read_with(cx, |state, _| {
        assert_eq!(
            images(&state.parsed_content.document.blocks)[0]
                .url
                .as_ref(),
            "https://images.example/b.png"
        );
    });
    let stale = parse_content(
        TextViewFormat::Markdown,
        ParsedContent::default(),
        &options(a, false, 1),
    )
    .unwrap();
    state.update(cx, |state, cx| {
        state.commit_parsed_update(
            ParsedUpdate {
                revision: 0,
                full_parse: true,
                selection_compatible: false,
                baseline_ack: false,
                result: Ok(stale),
            },
            cx,
        )
    });
    state.read_with(cx, |state, _| {
        assert_eq!(state.source().as_ref(), b);
        assert_eq!(
            images(&state.parsed_content.document.blocks)[0]
                .url
                .as_ref(),
            "https://images.example/b.png"
        );
    });
    state.update(cx, |state, cx| state.set_text("![logo][pic]", cx));
    cx.run_until_parked();
    state.read_with(cx, |state, _| {
        assert!(images(&state.parsed_content.document.blocks).is_empty());
        assert!(state.parsed_content.node_cx.link_refs.is_empty());
        assert_eq!(state.parsed_content.document.text(), "![logo][pic]\n");
    });
}

#[gpui::test]
fn async_append_reparses_are_reported_as_full_updates(cx: &mut gpui::TestAppContext) {
    cx.update(crate::init);
    let state = cx.update(|cx| cx.new(|cx| TextViewState::markdown("![logo][pic]\n\nTail", cx)));
    cx.run_until_parked();
    state.update(cx, |state, cx| {
        state.push_str("\n\n[pic]: https://images.example/a.png", cx)
    });
    cx.run_until_parked();
    state.read_with(cx, |state, _| {
        assert_eq!(images(&state.parsed_content.document.blocks).len(), 1);
        assert_eq!(state.parsed_content.node_cx.link_refs.len(), 1);
    });
    // Exercise the real UpdateFuture result metadata, which controls selection
    // remapping and virtualized row invalidation after a forward definition.
    let (tx, rx) = unbounded();
    let (result_tx, result_rx) = unbounded();
    let task = cx.update(|cx| {
        cx.background_spawn(UpdateFuture::new(TextViewFormat::Markdown, rx, result_tx))
    });
    tx.try_send(options("![logo][pic]\n\nTail", false, 1))
        .unwrap();
    cx.run_until_parked();
    result_rx.try_recv().unwrap();
    tx.try_send(options("\n\n[pic]: https://images.example/a.png", true, 2))
        .unwrap();
    cx.run_until_parked();
    let result = result_rx.try_recv().unwrap();
    assert!(
        result.full_parse,
        "definitions can change retained rows, not only the tail"
    );
    drop(task);
}

#[gpui::test]
fn asynchronous_replacements_and_disposal_do_not_keep_old_documents(cx: &mut gpui::TestAppContext) {
    cx.update(crate::init);
    let source = format!(
        "![logo][pic]\n\n{}\n\n[pic]: https://images.example/a.png",
        "prose ".repeat(MAX_SYNC_FULL_REPLACE_BYTES / 6 + 1),
    );
    let replacement = source.replace("a.png", "b.png");
    let state = cx.update(|cx| cx.new(|cx| TextViewState::markdown("initial", cx)));
    state.update(cx, |state, cx| {
        state.set_text(&source, cx);
        state.set_text(&replacement, cx);
    });
    cx.run_until_parked();
    state.read_with(cx, |state, _| {
        assert_eq!(state.source().as_ref(), replacement);
        assert_eq!(
            images(&state.parsed_content.document.blocks)[0]
                .url
                .as_ref(),
            "https://images.example/b.png"
        );
    });
    // Dispose with a new asynchronous parse still queued.
    state.update(cx, |state, cx| state.set_text(&source, cx));
    let weak = state.downgrade();
    drop(state);
    cx.run_until_parked();
    assert!(weak.upgrade().is_none());
}
