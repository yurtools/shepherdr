//! Tests in the actual Markdown adapter's private model scope.
use super::*;

fn document(source: &str) -> ParsedDocument {
    parse(source, &mut NodeContext::default()).unwrap()
}

fn paragraphs(blocks: &[BlockNode]) -> Vec<&Paragraph> {
    let mut out = Vec::new();
    for block in blocks {
        match block {
            BlockNode::Paragraph(p) | BlockNode::Heading { children: p, .. } => out.push(p),
            BlockNode::Root { children, .. }
            | BlockNode::Blockquote { children, .. }
            | BlockNode::List { children, .. }
            | BlockNode::ListItem { children, .. } => out.extend(paragraphs(children)),
            BlockNode::Table(table) => {
                for row in &table.children {
                    for cell in &row.children {
                        out.push(&cell.children);
                    }
                }
            }
            _ => {}
        }
    }
    out
}

pub(crate) fn images(blocks: &[BlockNode]) -> Vec<ImageNode> {
    paragraphs(blocks)
        .iter()
        .flat_map(|p| p.children.iter())
        .filter_map(|node| node.image.clone())
        .collect()
}

fn presentation(blocks: &[BlockNode]) -> Vec<Paragraph> {
    paragraphs(blocks).into_iter().map(|p| {
        let mut p = p.clone();
        p.span = None;
        for node in &mut p.children {
            node.source_segments.clear();
            if let Some(image) = &mut node.image { image.span = None; }
        }
        p
    }).collect()
}

#[test]
fn full_collapsed_shortcut_and_forward_references_match_inline_images() {
    let inline = document("before ![logo](https://images.example/a.png \"title\") after");
    let expected = images(&inline.blocks).remove(0);
    for reference in ["![logo][pic]", "![logo][]", "![logo]"] {
        let label = if reference.ends_with("[pic]") {
            "pic"
        } else {
            "logo"
        };
        for forward in [false, true] {
            let definition = format!("[{label}]: https://images.example/a.png \"title\"");
            let body = format!("before {reference} after");
            let source = if forward {
                format!("{body}\n\n{definition}")
            } else {
                format!("{definition}\n\n{body}")
            };
            let actual = document(&source);
            let found = images(&actual.blocks);
            assert_eq!(found.len(), 1, "reference image must be emitted: {source}");
            let mut image = found[0].clone();
            let start = source.find(reference).unwrap();
            assert_eq!(
                image.span,
                Some(Span {
                    start,
                    end: start + reference.len()
                })
            );
            image.span = expected.span;
            assert_eq!(image, expected, "{source}");
            let p = paragraphs(&actual.blocks)[0];
            assert_eq!(p.children.len(), 3);
            assert_eq!(p.children[0].text.as_ref(), "before ");
            assert_eq!(p.children[2].text.as_ref(), " after");
        }
    }
}

#[test]
fn normalized_labels_and_first_definition_match_the_parser() {
    for (reference, label) in [
        ("![logo][PiC]", "pic"),
        ("![logo][a  b]", "A\tB"),
        ("![logo][Straße]", "STRASSE"),
        ("![logo][ПРИВЕТ]", "привет"),
    ] {
        let source = format!(
            "{reference}\n\n[{label}]: https://images.example/first.png \"first\"\n[{label}]: https://images.example/last.png \"last\""
        );
        let image = images(&document(&source).blocks).remove(0);
        assert_eq!(image.url.as_ref(), "https://images.example/first.png");
        assert_eq!(image.title.as_deref(), Some("first"));
        // The real parser's HTML compiler independently specifies first-wins.
        let html = markdown::to_html(&source);
        assert!(html.contains("https://images.example/first.png"));
        assert!(!html.contains("https://images.example/last.png"));
    }
}

#[test]
fn undefined_and_escaped_references_remain_parser_literal_text() {
    for source in [
        "before ![logo][missing] after",
        "![missing][]",
        "![missing]",
        r"\![logo][missing]",
    ] {
        let doc = document(source);
        assert!(images(&doc.blocks).is_empty());
        let expected = source.strip_prefix('\\').unwrap_or(source);
        assert_eq!(
            paragraphs(&doc.blocks)[0]
                .children
                .iter()
                .map(|n| n.text.as_ref())
                .collect::<String>(),
            expected
        );
    }
    // A defined alt label does not rescue this undefined full reference in
    // markdown-rs 1.0.0; do not manufacture a shortcut image from its text.
    let doc = document("![logo][missing]\n\n[logo]: https://images.example/a.png");
    assert!(images(&doc.blocks).is_empty());
    assert_eq!(
        paragraphs(&doc.blocks)[0].children.iter().map(|n| n.text.as_ref()).collect::<String>(),
        "![logo][missing]"
    );
}

#[test]
fn nested_links_emphasis_tables_and_container_definitions_keep_images() {
    for (inline, reference) in [
        (
            "**left ![logo](https://images.example/a.png) right**",
            "**left ![logo][pic] right**",
        ),
        (
            "[![logo](https://images.example/a.png)](https://links.example/)",
            "[![logo][pic]](https://links.example/)",
        ),
        (
            "*[left ![logo](https://images.example/a.png) right][link]*",
            "*[left ![logo][pic] right][link]*",
        ),
        (
            "| Image |\n| --- |\n| ![logo](https://images.example/a.png) |",
            "| Image |\n| --- |\n| ![logo][pic] |",
        ),
        ("> ![logo](https://images.example/a.png)", "> ![logo][pic]"),
        ("- ![logo](https://images.example/a.png)", "- ![logo][pic]"),
    ] {
        let defs = "\n\n> [pic]: https://images.example/a.png\n\n[link]: https://links.example/";
        assert_eq!(
            presentation(&document(&format!("{inline}{defs}")).blocks),
            presentation(&document(&format!("{reference}{defs}")).blocks),
            "text order and all nested emphasis/link marks: {reference}",
        );
        let mut expected = images(&document(&format!("{inline}{defs}")).blocks).remove(0);
        let actual = images(&document(&format!("{reference}{defs}")).blocks).remove(0);
        expected.span = actual.span;
        assert_eq!(actual, expected, "{reference}");
        if reference.contains("links.example") || reference.contains("[link]") {
            assert_eq!(
                actual.link.as_ref().unwrap().url.as_ref(),
                "https://links.example/"
            );
        }
    }
}

#[test]
fn alt_title_source_spans_and_adjacent_unicode_survive() {
    let source = "é before ![a &amp; b\\!][pic] after λ\n\n[pic]: <https://images.example/a.png> 'a &amp; title'";
    let doc = document(source);
    let image = images(&doc.blocks).remove(0);
    assert_eq!(image.alt.as_deref(), Some("a & b!"));
    assert_eq!(image.title.as_deref(), Some("a & title"));
    let span = image.span.unwrap();
    assert_eq!(&source[span.start..span.end], "![a &amp; b\\!][pic]");
    let p = paragraphs(&doc.blocks)[0];
    assert_eq!(p.children[0].text.as_ref(), "é before ");
    assert_eq!(p.children[2].text.as_ref(), " after λ");
    let segments = &p.children[2].source_segments;
    assert_eq!(segments[0].source.start, span.end);
    let mut cx = NodeContext {
        offset: 700,
        ..Default::default()
    };
    let doc = parse(source, &mut cx).unwrap();
    assert_eq!(
        images(&doc.blocks)[0].span,
        Some(Span {
            start: span.start + 700,
            end: span.end + 700
        })
    );
}

#[test]
fn image_source_selection_includes_reference_syntax_not_definition() {
    let source = "before ![logo][pic] after\n\n[pic]: https://images.example/a.png";
    let mut doc = document(source);
    let BlockNode::Paragraph(p) = &mut Arc::make_mut(&mut doc.blocks)[0] else {
        panic!()
    };
    // The run before an inline image is held on the image child's state.
    let mut before = p.children[1].state.lock().unwrap();
    before.set_text("before ".into());
    before.selection = Some((0..7).into());
    drop(before);
    let mut after = p.state.lock().unwrap();
    after.set_text(" after".into());
    after.selection = Some((0..6).into());
    drop(after);
    assert_eq!(
        doc.selected_source_range(),
        Some(0..source.find("\n\n").unwrap())
    );
}
