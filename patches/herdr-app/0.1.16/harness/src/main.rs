//! Runs the host's real font selector, Markdown adapter, layout and optional GPU renderer.
//! No Herdr app, service, mods, settings or native windows are started.
use anyhow::Result;
use gpui::{prelude::*, *};
use gpui_wgpu::CosmicTextSystem;
use std::{
    borrow::Cow,
    sync::{Arc, Mutex},
};

// Written by build.rs from the exact runtime bundle declaration, never a test copy.
include!(concat!(env!("OUT_DIR"), "/bundled_fonts.rs"));

struct Trace {
    native: CosmicTextSystem,
    lines: Mutex<Vec<(String, LineLayout)>>,
}
impl Trace {
    fn new() -> Self {
        Self {
            native: CosmicTextSystem::new_without_system_fonts("Geist"),
            lines: Mutex::default(),
        }
    }
}
impl PlatformTextSystem for Trace {
    fn add_fonts(&self, f: Vec<Cow<'static, [u8]>>) -> Result<()> {
        self.native.add_fonts(f)
    }
    fn all_font_names(&self) -> Vec<String> {
        self.native.all_font_names()
    }
    fn font_id(&self, font: &Font) -> Result<FontId> {
        let id = self.native.font_id(font)?;
        Ok(id)
    }
    fn set_missing_glyph_sink(&self, sink: Option<Arc<dyn MissingGlyphSink>>) {
        self.native.set_missing_glyph_sink(sink)
    }
    fn prewarm_fonts(&self, ids: &[FontId]) {
        self.native.prewarm_fonts(ids)
    }
    fn font_table(&self, id: FontId, tag: [u8; 4]) -> Option<Vec<u8>> {
        self.native.font_table(id, tag)
    }
    fn font_metrics(&self, id: FontId) -> FontMetrics {
        self.native.font_metrics(id)
    }
    fn typographic_bounds(&self, id: FontId, g: GlyphId) -> Result<Bounds<f32>> {
        self.native.typographic_bounds(id, g)
    }
    fn advance(&self, id: FontId, g: GlyphId) -> Result<Size<f32>> {
        self.native.advance(id, g)
    }
    fn glyph_for_char(&self, id: FontId, c: char) -> Option<GlyphId> {
        self.native.glyph_for_char(id, c)
    }
    fn glyph_uses_foreground(&self, p: &RenderGlyphParams) -> bool {
        self.native.glyph_uses_foreground(p)
    }
    fn glyph_raster_bounds(&self, p: &RenderGlyphParams) -> Result<Bounds<DevicePixels>> {
        self.native.glyph_raster_bounds(p)
    }
    fn rasterize_glyph(
        &self,
        p: &RenderGlyphParams,
        b: Bounds<DevicePixels>,
    ) -> Result<(Size<DevicePixels>, Vec<u8>)> {
        self.native.rasterize_glyph(p, b)
    }
    fn layout_line(&self, t: &str, s: Pixels, r: &[FontRun]) -> LineLayout {
        let layout = self.native.layout_line(t, s, r);
        self.lines.lock().unwrap().push((t.into(), layout.clone()));
        layout
    }
    fn recommended_rendering_mode(&self, id: FontId, s: Pixels) -> TextRenderingMode {
        self.native.recommended_rendering_mode(id, s)
    }
}

struct Scene {
    text: String,
    markdown: bool,
    strong: bool,
    italic: bool,
}
impl Render for Scene {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(rgb(0xffffff))
            .text_color(rgb(0x111111))
            .font_family("Geist")
            .text_size(px(24.))
            .child(if self.markdown {
                gpui_base::TextView::markdown("stable-preview", self.text.clone())
                    .scrollable(false)
                    .into_any_element()
            } else {
                div()
                    .when(self.strong, |d| d.font_weight(FontWeight::BOLD))
                    .when(self.italic, |d| d.italic())
                    .child(self.text.clone())
                    .into_any_element()
            })
    }
}

fn check_current(trace: &Trace, needle: &str, expected: (FontWeight, FontStyle), diagnose: bool) {
    let lines = trace.lines.lock().unwrap();
    let mut matched = 0;
    for (text, layout) in lines.iter() {
        let Some(start) = text.find(needle) else {
            continue;
        };
        let end = start + needle.len();
        for run in &layout.runs {
            for glyph in &run.glyphs {
                if glyph.index >= start && glyph.index < end {
                    assert_ne!(glyph.id.0, 0, "missing glyph in {text:?}");
                    assert!(
                        text.is_char_boundary(glyph.index),
                        "UTF-8 glyph index must be a source boundary"
                    );
                    let actual = trace.native.font_weight_and_style(run.font_id).unwrap();
                    if !diagnose {
                        assert_eq!(
                            actual, expected,
                            "actual current glyph face for {needle:?} in {text:?}"
                        );
                    }
                    matched += 1;
                }
            }
        }
    }
    assert!(
        matched > 0,
        "no current native layout for {needle:?}: {lines:?}"
    );
    println!(
        "{} current layout {needle:?}: expected {expected:?}; {matched} visible glyphs",
        if diagnose { "DIAGNOSTIC" } else { "PASS" }
    );
}

fn main() -> Result<()> {
    let args: Vec<_> = std::env::args().collect();
    let diagnose = args.iter().any(|x| x == "--diagnose");
    let pixels = args.iter().any(|x| x == "--pixels");
    let controls = args.iter().any(|x| x == "--control-dir");
    let trace = Arc::new(Trace::new());
    trace.add_fonts(BUNDLED_FONTS.iter().map(|b| Cow::Borrowed(*b)).collect())?;
    // Optional test-only static control/fallback, never an installation dependency.
    if let Some(dir) = args
        .iter()
        .position(|x| x == "--control-dir")
        .and_then(|i| args.get(i + 1))
    {
        for name in [
            "DejaVuSans.ttf",
            "DejaVuSans-Bold.ttf",
            "DejaVuSans-Oblique.ttf",
            "DejaVuSans-BoldOblique.ttf",
            "DejaVuSansMono.ttf",
            "DejaVuSansMono-Bold.ttf",
            "DejaVuSansMono-Oblique.ttf",
            "DejaVuSansMono-BoldOblique.ttf",
        ] {
            trace.add_fonts(vec![Cow::Owned(std::fs::read(
                std::path::Path::new(dir).join(name),
            )?)])?;
        }
    }
    for family in ["Geist", "Geist Mono", "JetBrains Mono", "DejaVu Sans"] {
        if !trace.all_font_names().iter().any(|f| f == family) {
            continue;
        }
        for (weight, style) in [
            (FontWeight::NORMAL, FontStyle::Normal),
            (FontWeight::BOLD, FontStyle::Normal),
            (FontWeight::NORMAL, FontStyle::Italic),
            (FontWeight::BOLD, FontStyle::Italic),
        ] {
            let id = trace.native.font_id(&Font {
                weight,
                style,
                ..font(family)
            })?;
            let chosen = trace.native.font_weight_and_style(id)?;
            println!(
                "FACE {family}: requested {weight:?}/{style:?}; selected {chosen:?}; id={id:?}"
            );
        }
    }
    let mut cx = HeadlessAppContext::with_platform(trace.clone(), Arc::new(()), move || {
        if pixels {
            Ok(Some(Box::new(gpui_wgpu::WgpuHeadlessRenderer::new()?)))
        } else {
            Ok(None)
        }
    });
    cx.update(gpui_base::init);
    let window = cx.open_window(size(px(640.), px(440.)), |_, cx| {
        cx.new(|_| Scene {
            text: String::new(),
            markdown: true,
            strong: false,
            italic: false,
        })
    })?;
    let mut render = |source: &str,
                      markdown: bool,
                      strong: bool,
                      italic: bool|
     -> Result<Option<image::RgbaImage>> {
        trace.lines.lock().unwrap().clear();
        // Font descriptors are cached by GPUI. Assertions use THIS render's actual
        // shaped glyph runs, not a cumulative history of descriptor requests.
        window.update(&mut cx, |scene, _, cx| {
            scene.text = source.into();
            scene.markdown = markdown;
            scene.strong = strong;
            scene.italic = italic;
            cx.notify();
        })?;
        cx.run_until_parked();
        cx.update_window(window.into(), |_, w, cx| {
            let _ = w.draw(cx);
        })?;
        cx.run_until_parked();
        cx.update_window(window.into(), |_, w, cx| {
            let _ = w.draw(cx);
        })?;
        if pixels {
            Ok(Some(window.render_current_to_image(&mut cx)?))
        } else {
            Ok(None)
        }
    };
    let regular = (FontWeight::NORMAL, FontStyle::Normal);
    let bold = (FontWeight::BOLD, FontStyle::Normal);
    let italic = (FontWeight::NORMAL, FontStyle::Italic);
    let both = (FontWeight::BOLD, FontStyle::Italic);
    for (source, needle, style) in [
        ("**aster**", "aster", bold),
        ("__under__", "under", bold),
        ("*slope*", "slope", italic),
        ("***combo***", "combo", both),
        ("before **strong *nested* end** after", "nested", both),
        ("*outer **centre** tail*", "centre", both),
        (r"\*\*escaped\*\*", "**escaped**", regular),
        ("**[linked](https://example.invalid)**", "linked", bold),
        ("**`coded`**", "coded", bold),
    ] {
        if needle == "coded" && !controls {
            println!("NOT RUN bold code: provide --control-dir for the default theme mono family");
            continue;
        }
        render(source, true, false, false)?;
        check_current(&trace, needle, style, diagnose);
        if needle == "nested" {
            check_current(&trace, "before", regular, diagnose);
            check_current(&trace, "strong", bold, diagnose);
            check_current(&trace, "after", regular, diagnose);
        }
    }
    if controls {
        render("café Ελληνικά א", true, false, false)?;
        check_current(&trace, "café Ελληνικά א", regular, false);
        let ids: std::collections::BTreeSet<_> = trace
            .lines
            .lock()
            .unwrap()
            .iter()
            .flat_map(|(_, l)| l.runs.iter().map(|r| r.font_id.0))
            .collect();
        assert!(
            ids.len() > 1,
            "UTF-8 fixture must exercise a real fallback face"
        );
        println!(
            "PASS UTF-8 fallback: nonzero glyphs, valid source indices, {} actual faces",
            ids.len()
        );
    }
    // Each replacement has the same byte length and uses the same TextView id.
    // Distinct visible words force a current shape even when global line caching
    // could reuse a previous identical (text, runs) pair.
    for (source, needle, style) in [
        ("**before**", "before", bold),
        ("  after!  ", "after!", regular),
        ("__reload__", "reload", bold),
    ] {
        assert_eq!(source.len(), 10);
        render(source, true, false, false)?;
        check_current(&trace, needle, style, diagnose);
    }
    render("**toggle**", false, false, false)?;
    check_current(&trace, "**toggle**", regular, diagnose);
    render("**toggle**", true, false, false)?;
    check_current(&trace, "toggle", bold, diagnose);
    println!(
        "{} same-length replacements/reload and Source/Preview remount: current glyph faces checked",
        if diagnose { "DIAGNOSTIC" } else { "PASS" }
    );
    // Identical visible text with only marker/style changes exercises the caches.
    // Only a captured current frame can prove a reused cached layout's pixels.
    if pixels {
        let plain = render("  sample  ", true, false, false)?.unwrap();
        let strong = render("**sample**", true, false, false)?.unwrap();
        let reloaded = render("__sample__", true, false, false)?.unwrap();
        render("__sample__", false, false, false)?;
        let toggled = render("__sample__", true, false, false)?.unwrap();
        if !diagnose {
            assert_ne!(plain, strong, "strong glyphs must differ from regular");
            assert_eq!(strong, reloaded);
            assert_eq!(strong, toggled);
        }
        let matrix=render("Regular: sample text\n\n**Bold: sample text**\n\n*Italic: sample text*\n\n***Bold italic: sample text***\n\n**Section 1.2 table 3 row 4, EXAMPLE-5, Partial.**",true,false,false)?.unwrap();
        matrix.save("native-emphasis.png")?;
        plain.save("markdown-regular.png")?;
        strong.save("markdown-bold.png")?;
        let div_plain = render("native-control", false, false, false)?.unwrap();
        let div_bold = render("native-control", false, true, false)?.unwrap();
        if !diagnose {
            assert_ne!(
                div_plain, div_bold,
                "native div font_bold must differ from regular"
            );
        }
        println!(
            "PIXELS Markdown regular==bold: {}; native div regular==bold: {}",
            plain == strong,
            div_plain == div_bold
        );
    } else {
        println!("NOT RUN identical-visible-text cached-frame pixel acceptance (use --pixels)");
    }
    println!(
        "COMPLETE real host font selection and Markdown layout; diagnostic={diagnose}, pixels={pixels}"
    );
    Ok(())
}
