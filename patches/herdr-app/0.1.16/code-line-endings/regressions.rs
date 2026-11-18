//! Runs against the actual adapter/model, with no substitute parser or nodes.
use super::*;

fn document(source: &str) -> ParsedDocument {
    parse(source, &mut NodeContext::default()).unwrap()
}

fn codes(blocks: &[BlockNode]) -> Vec<&CodeBlock> {
    let mut found = Vec::new();
    for block in blocks {
        match block {
            BlockNode::CodeBlock(code) => found.push(code),
            BlockNode::Root { children, .. }
            | BlockNode::Blockquote { children, .. }
            | BlockNode::List { children, .. }
            | BlockNode::ListItem { children, .. } => found.extend(codes(children)),
            _ => {}
        }
    }
    found
}

fn signature(block: &BlockNode) -> String {
    match block {
        BlockNode::Paragraph(p) => format!("P{:?}", p.text()),
        BlockNode::CodeBlock(c) => format!("C{:?}", c.code()),
        BlockNode::Root { children, .. } => format!("R{:?}", signatures(children)),
        BlockNode::Blockquote { children, .. } => format!("Q{:?}", signatures(children)),
        BlockNode::List { children, .. } => format!("L{:?}", signatures(children)),
        BlockNode::ListItem { children, .. } => format!("I{:?}", signatures(children)),
        _ => panic!("unexpected newline-fixture block: {block:?}"),
    }
}

fn signatures(blocks: &[BlockNode]) -> Vec<String> {
    blocks.iter().map(signature).collect()
}

fn prose(blocks: &[BlockNode]) -> Vec<String> {
    let mut found = Vec::new();
    for block in blocks {
        match block {
            BlockNode::Paragraph(p) => found.push(p.text()),
            BlockNode::Root { children, .. }
            | BlockNode::Blockquote { children, .. }
            | BlockNode::List { children, .. }
            | BlockNode::ListItem { children, .. } => found.extend(prose(children)),
            _ => {}
        }
    }
    found
}

#[test]
fn audit_39_fixtures_keep_equivalent_models_and_original_sources() {
    let fixtures: BTreeMap<String, String> =
        serde_json::from_str(include_str!("code_line_endings_fixtures.json")).unwrap();
    assert_eq!(fixtures.len(), 39);
    for (name, source) in &fixtures {
        let family = name.rsplit_once('-').unwrap().0;
        let baseline = document(&fixtures[&format!("{family}-LF")]);
        let actual = document(source);
        assert_eq!(actual.source.as_ref(), source, "source bytes: {name}");
        assert_eq!(
            signatures(&actual.blocks),
            signatures(&baseline.blocks),
            "{name}"
        );
        if family.ends_with("soft") {
            assert_eq!(prose(&actual.blocks), ["a b"], "{name}");
        } else if family.ends_with("hard") {
            assert_eq!(prose(&actual.blocks), ["a\nb"], "{name}");
        } else if family.ends_with("paragraph") {
            assert_eq!(prose(&actual.blocks), ["a", "b"], "{name}");
        } else {
            assert_eq!(codes(&actual.blocks)[0].code().as_ref(), "a\nb", "{name}");
        }
    }
}

#[test]
fn code_rows_map_every_unicode_character_and_original_eol() {
    // Prefix-looking content catches accidental mapping to quote/list syntax.
    for eol in ["\n", "\r\n", "\r"] {
        for (open, prefix, close) in [
            ("```txt", "", "```"),
            ("~~~txt", "", "~~~"),
            ("", "    ", ""),
            ("> ```txt", "> ", "> ```"),
            ("- ~~~txt", "  ", "  ~~~"),
            ("> - ```txt", ">   ", ">   ```"),
        ] {
            let lines = ["α > β", "> λ", "  café 🦀", "end"];
            let body = lines.map(|line| format!("{prefix}{line}")).join(eol);
            let source = if open.is_empty() {
                format!("before{eol}{eol}{body}{eol}{eol}after")
            } else {
                format!("before{eol}{eol}{open}{eol}{body}{eol}{close}{eol}{eol}after")
            };
            let parsed = document(&source);
            let code = codes(&parsed.blocks)[0];
            assert_eq!(code.code().as_ref(), lines.join("\n"), "{source:?}");
            let mut offset = 0;
            let mut rendered = 0;
            for (index, line) in lines.iter().enumerate() {
                let start = source[offset..].find(&format!("{prefix}{line}")).unwrap()
                    + offset
                    + prefix.len();
                for (byte, character) in line.char_indices() {
                    code.set_selection(rendered + byte..rendered + byte + character.len_utf8());
                    assert_eq!(
                        parsed.selected_source_range(),
                        Some(start + byte..start + byte + character.len_utf8()),
                        "{source:?}, {character:?}"
                    );
                }
                offset = start + line.len();
                rendered += line.len();
                if index + 1 < lines.len() {
                    code.set_selection(rendered..rendered + 1);
                    assert_eq!(
                        parsed.selected_source_range(),
                        Some(offset..offset + eol.len()),
                        "EOL: {source:?}"
                    );
                    rendered += 1;
                }
            }
            code.set_selection(0..code.code().len());
            let range = parsed.selected_source_range().unwrap();
            assert!(source[range].starts_with(lines[0]));
            assert_eq!(code.selected_text(), lines.join("\n"));
        }
    }
}

#[test]
fn mixed_eols_blank_code_lines_and_offsets_are_exact() {
    let source = "前\r\n\r\n```txt\rα\r\n\rβ\n\nγ\r```\r\nafter";
    let mut cx = NodeContext {
        offset: 83,
        ..Default::default()
    };
    let parsed = parse(source, &mut cx).unwrap();
    let code = codes(&parsed.blocks)[0];
    assert_eq!(code.code().as_ref(), "α\n\nβ\n\nγ");
    for (rendered, original) in [(2..3, "\r\n"), (3..4, "\r"), (6..7, "\n"), (7..8, "\n")] {
        code.set_selection(rendered);
        let range = parsed.selected_source_range().unwrap();
        assert_eq!(&source[range.start - 83..range.end - 83], original);
    }
    let start = source.find('γ').unwrap() + 83;
    code.set_selection(8..10);
    assert_eq!(parsed.selected_source_range(), Some(start..start + 2));
}

#[test]
fn code_copy_is_explicitly_lf_while_source_selection_keeps_original_bytes() {
    for eol in ["\n", "\r\n", "\r"] {
        let source = format!("```txt{eol}a{eol}β{eol}```");
        let parsed = document(&source);
        let code = codes(&parsed.blocks)[0];
        // Public code actions and highlighters see the same LF byte model.
        assert_eq!(code.code().as_ref(), "a\nβ");
        code.set_selection(0..4);
        assert_eq!(code.selected_text(), "a\nβ");
        assert_eq!(code.selected_source(), "```txt\na\nβ\n```");
        assert_eq!(
            parsed.selected_text(crate::text::SelectionFormat::Plain, None),
            "a\nβ\n"
        );
        assert_eq!(
            parsed.selected_text(crate::text::SelectionFormat::Source, None),
            "```txt\na\nβ\n```"
        );
        let range = parsed.selected_source_range().unwrap();
        assert_eq!(&source[range], format!("a{eol}β"));
        code.set_selection(2..4);
        assert_eq!(code.selected_text(), "β");
        assert_eq!(code.selected_source(), "```txt\nβ\n```");
    }
    // No global change to non-Markdown/code API callers.
    let raw = CodeBlock::from_code("a\r\nb\rc", None::<SharedString>);
    assert_eq!(raw.code().as_ref(), "a\r\nb\rc");
}

#[test]
fn whole_interior_source_blocks_still_copy_original_eols() {
    // The existing Source-copy policy preserves whole interior blocks verbatim.
    // It is separate from code-only selection and public code-action payloads.
    let source = "before\r\n\r\n```txt\r\na\r\nb\r\n```\r\n\r\nafter";
    let parsed = document(source);
    let code = codes(&parsed.blocks)[0];
    code.set_selection(0..3);
    let copied = parsed.selected_text(crate::text::SelectionFormat::Source, Some(0..=2));
    assert!(copied.contains("```txt\r\na\r\nb\r\n```"));
    assert_eq!(parsed.source.as_ref(), source);
}

#[test]
fn soft_hard_and_paragraph_breaks_remain_distinct() {
    for eol in ["\n", "\r\n", "\r"] {
        for (prefix, continuation, suffix) in [("", "", ""), ("> ", "> ", ""), ("- ", "  ", "")] {
            let soft = document(&format!("{prefix}a{eol}{continuation}b{suffix}"));
            let hard = document(&format!("{prefix}a  {eol}{continuation}b{suffix}"));
            let slash = document(&format!("{prefix}a\\{eol}{continuation}b{suffix}"));
            assert_ne!(signatures(&soft.blocks), signatures(&hard.blocks));
            assert_eq!(signatures(&hard.blocks), signatures(&slash.blocks));
        }
        let paragraphs = document(&format!("a{eol}{eol}b"));
        assert_eq!(signatures(&paragraphs.blocks), vec!["P\"a\"", "P\"b\""]);
    }
}

#[test]
fn unclosed_empty_fences_and_literal_escapes_keep_boundaries() {
    for eol in ["\n", "\r\n", "\r"] {
        for source in [
            format!("````txt{eol}```{eol}a\\\\b{eol}end"),
            format!("~~~txt{eol}~~~"),
        ] {
            let parsed = document(&source);
            let code = codes(&parsed.blocks)[0];
            assert!(!code.code().contains('\r'));
            if !code.code().is_empty() {
                let start = source.find("a\\\\b").unwrap();
                code.set_selection(4..8);
                assert_eq!(parsed.selected_source_range(), Some(start..start + 4));
            }
        }
    }
}

#[test]
fn long_crlf_code_keeps_compact_mappings_and_final_selection() {
    let source = format!("```txt\r\n{}end 🦀\r\n```", "α β\r\n".repeat(16_384));
    let parsed = document(&source);
    let code = codes(&parsed.blocks)[0];
    assert_eq!(parsed.source.as_ref(), source);
    assert!(!code.code().contains('\r'));
    assert!(code.source_segments.len() <= 2 * 16_384 + 1);
    let start = code.code().len() - "end 🦀".len();
    code.set_selection(start..code.code().len());
    let original = source.find("end 🦀").unwrap();
    assert_eq!(
        parsed.selected_source_range(),
        Some(original..original + "end 🦀".len())
    );
    assert_eq!(code.selected_text(), "end 🦀");
}

#[test]
fn trailing_blank_code_copy_and_literal_tabs_keep_their_policy() {
    for eol in ["\n", "\r\n", "\r"] {
        let source = format!("```txt{eol}\tα{eol}{eol}```");
        let parsed = document(&source);
        let code = codes(&parsed.blocks)[0];
        assert_eq!(code.code().as_ref(), "\tα\n");
        code.set_selection(0..4);
        assert_eq!(code.selected_text(), "\tα\n");
        assert_eq!(code.selected_source(), "```txt\n\tα\n```");
        let start = source.find('\t').unwrap();
        assert_eq!(
            parsed.selected_source_range(),
            Some(start..start + 3 + eol.len())
        );
    }
}

#[test]
fn same_length_eol_replacements_keep_distinct_original_source_maps() {
    let before = "```txt\na\r\nβ\nc\n```";
    let after = "```txt\na\nβ\r\nc\n```";
    assert_eq!(before.len(), after.len());
    let old = document(before);
    let new = document(after);
    let old_code = codes(&old.blocks)[0];
    let new_code = codes(&new.blocks)[0];
    assert_eq!(old_code.code(), new_code.code());
    assert_eq!(old_code.span, new_code.span);
    assert_ne!(
        old_code, new_code,
        "model equality must include different source mappings"
    );
    for (source, parsed, code) in [(before, &old, old_code), (after, &new, new_code)] {
        code.set_selection(2..4);
        let start = source.find('β').unwrap();
        assert_eq!(parsed.selected_source_range(), Some(start..start + 2));
    }
}
