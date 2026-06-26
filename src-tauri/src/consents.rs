use printpdf::{
    image_crate::codecs::png::PngDecoder, BuiltinFont, Image, ImageTransform, Mm, PdfDocument,
};
use std::io::{BufWriter, Cursor};

pub struct ConsentPdf<'a> {
    pub title: &'a str,
    pub patient_name: &'a str,
    pub signed_at: &'a str,
    pub body: &'a str,
    pub signature_png: &'a [u8],
}

pub fn render_consent_pdf(input: &ConsentPdf<'_>) -> Result<Vec<u8>, String> {
    let (document, page, layer) =
        PdfDocument::new(input.title, Mm(210.0), Mm(297.0), "VeloDent Consenso");
    let layer = document.get_page(page).get_layer(layer);
    let font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|error| error.to_string())?;
    let bold_font = document
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|error| error.to_string())?;

    write_text(&layer, &bold_font, 18.0, 15.0, 280.0, "VeloDent");
    write_text(&layer, &bold_font, 13.0, 15.0, 270.0, input.title);
    write_text(
        &layer,
        &font,
        9.0,
        15.0,
        262.0,
        &format!("Paziente: {}", input.patient_name),
    );

    let mut y = 248.0;
    for paragraph in input.body.lines() {
        if paragraph.trim().is_empty() {
            y -= 5.0;
            continue;
        }
        for line in wrap_line(paragraph.trim(), 92) {
            write_text(&layer, &font, 9.0, 15.0, y, &line);
            y -= 5.3;
            if y < 62.0 {
                break;
            }
        }
        y -= 2.5;
        if y < 62.0 {
            write_text(
                &layer,
                &font,
                8.0,
                15.0,
                y,
                "Testo troncato: consultare il modello digitale originale.",
            );
            break;
        }
    }

    write_text(&layer, &bold_font, 10.0, 15.0, 45.0, "Firma paziente");
    write_text(
        &layer,
        &font,
        8.0,
        115.0,
        45.0,
        &format!("Firmato il {}", input.signed_at),
    );

    let mut signature_reader = Cursor::new(input.signature_png);
    let decoder = PngDecoder::new(&mut signature_reader).map_err(|error| error.to_string())?;
    let signature = Image::try_from(decoder).map_err(|error| error.to_string())?;
    signature.add_to_layer(
        layer,
        ImageTransform {
            translate_x: Some(Mm(15.0)),
            translate_y: Some(Mm(16.0)),
            scale_x: Some(0.25),
            scale_y: Some(0.25),
            ..Default::default()
        },
    );

    let mut output = Vec::new();
    document
        .save(&mut BufWriter::new(&mut output))
        .map_err(|error| error.to_string())?;
    Ok(output)
}

fn write_text(
    layer: &printpdf::PdfLayerReference,
    font: &printpdf::IndirectFontRef,
    size: f32,
    x: f32,
    y: f32,
    text: &str,
) {
    layer.use_text(text, size, Mm(x), Mm(y), font);
}

fn wrap_line(value: &str, max_chars: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut current = String::new();
    for word in value.split_whitespace() {
        let next_len =
            current.chars().count() + word.chars().count() + usize::from(!current.is_empty());
        if next_len > max_chars && !current.is_empty() {
            lines.push(current);
            current = String::new();
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(word);
    }
    if !current.is_empty() {
        lines.push(current);
    }
    lines
}
