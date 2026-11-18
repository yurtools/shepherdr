//! Actual vendored GPUI/Markdown model and headless rendering; never an OS window.
use anyhow::Result;
use gpui::{prelude::*, *};
use gpui_wgpu::CosmicTextSystem;
use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};

struct Scene(String, Arc<Mutex<Vec<String>>>);
impl Render for Scene {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let observed = self.1.clone();
        div()
            .size_full()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111111))
            .font_family("Geist")
            .text_size(px(20.))
            .child(
                gpui_base::TextView::markdown("stable-preview", self.0.clone())
                    .code_block_highlighter(move |code| {
                        observed.lock().unwrap().push(code.code().to_string());
                        Vec::new()
                    })
                    .scrollable(false),
            )
    }
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let pixels = args.iter().any(|a| a == "--pixels");
    let diagnose = args.iter().any(|a| a == "--diagnose");
    // Same read-only system-font discovery as the host; this test changes no fonts.
    let native = Arc::new(CosmicTextSystem::new("Geist"));
    native.add_fonts(vec![Cow::Owned(std::fs::read(std::env::var(
        "HERDR_CODE_FONT",
    )?)?)])?;
    let mut cx = HeadlessAppContext::with_platform(native, Arc::new(()), move || {
        if pixels {
            Ok(Some(Box::new(gpui_wgpu::WgpuHeadlessRenderer::new()?)))
        } else {
            Ok(None)
        }
    });
    cx.update(gpui_base::init);
    if !diagnose {
        gpui_base::text::verify_code_line_endings();
    }
    let observed = Arc::new(Mutex::new(Vec::new()));
    let window = cx.open_window(size(px(640.), px(300.)), |_, cx| {
        cx.new(|_| Scene(String::new(), observed.clone()))
    })?;
    let mut frames = Vec::new();
    for (name, eol) in [("LF", "\n"), ("CRLF", "\r\n"), ("CR", "\r")] {
        observed.lock().unwrap().clear();
        let source = format!(
            "Before{eol}{eol}```txt{eol}first code row{eol}second code row{eol}```{eol}{eol}After"
        );
        if !diagnose {
            let state =
                cx.update(|cx| cx.new(|cx| gpui_base::TextViewState::markdown(&source, cx)));
            cx.run_until_parked();
            state.update(&mut cx, |state, cx| state.select_all(cx));
            state.read_with(&cx, |state, _| {
                assert!(!state.selected_text().contains('\r'));
                assert!(
                    state
                        .selected_text()
                        .contains("first code row\nsecond code row")
                );
            });
            state.update(&mut cx, |state, cx| {
                state.set_selection_format(gpui_base::SelectionFormat::Source, cx)
            });
            state.read_with(&cx, |state, _| {
                assert_eq!(
                    state.selected_text(),
                    source,
                    "Source select-all retains original bytes"
                );
                assert_eq!(state.selected_source_range(), Some(0..source.len()));
            });
            println!("PASS real TextViewState plain/source select-all policy for {name}");
        }
        let code = gpui_base::text::code_line_ending_payloads(&source).remove(0);
        let rows = cx.update_window(window.into(), |_, window, _| {
            let run = TextRun {
                len: code.len(),
                font: font("Geist"),
                color: rgb(0x111111).into(),
                background_color: None,
                underline: None,
                strikethrough: None,
            };
            window
                .text_system()
                .shape_text(code.into(), px(20.), &[run], None, None)
        })??;
        let actual: Vec<_> = rows.iter().map(|row| row.text.to_string()).collect();
        println!("NATIVE SHAPE {name}: {actual:?}");
        if !diagnose {
            assert_eq!(actual, ["first code row", "second code row"]);
        }
        window.update(&mut cx, |scene, _, cx| {
            scene.0 = source;
            cx.notify();
        })?;
        cx.run_until_parked();
        for _ in 0..2 {
            cx.update_window(window.into(), |_, window, cx| {
                let _ = window.draw(cx);
            })?;
            cx.run_until_parked();
        }
        if !diagnose {
            let calls = observed.lock().unwrap();
            assert!(!calls.is_empty(), "real code highlighter must run");
            assert!(
                calls
                    .iter()
                    .all(|payload| payload == "first code row\nsecond code row")
            );
            println!("PASS actual highlighter receives LF payload for {name}");
        }
        if pixels {
            let frame = window.render_current_to_image(&mut cx)?;
            frame.save(format!("{name}.png"))?;
            frames.push(frame);
        }
    }
    if pixels && !diagnose {
        assert_eq!(frames[0], frames[1], "same native pixels for LF and CRLF");
        assert_eq!(frames[0], frames[2], "same native pixels for LF and CR");
        println!("PASS native headless frames are byte-identical across LF/CRLF/CR");
    }
    Ok(())
}
