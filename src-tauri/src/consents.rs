use printpdf::{
    image_crate::{self, ImageFormat, Rgb, RgbImage},
    lopdf::{self, xref::XrefType, Object},
    BuiltinFont, ColorBits, ColorSpace, Image, ImageTransform, ImageXObject, Mm, PdfDocument, Px,
};
use std::io::BufWriter;

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

    let signature = Image::from(flatten_signature_png(input.signature_png)?);
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
    normalize_pdf_for_viewers(output)
}

pub fn normalize_consent_pdf_bytes(bytes: &[u8]) -> Result<Vec<u8>, String> {
    normalize_pdf_for_viewers(bytes.to_vec())
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

fn flatten_signature_png(bytes: &[u8]) -> Result<ImageXObject, String> {
    let image = image_crate::load_from_memory_with_format(bytes, ImageFormat::Png)
        .map_err(|error| error.to_string())?
        .to_rgba8();
    let width = image.width();
    let height = image.height();
    let mut flattened = RgbImage::new(image.width(), image.height());

    for (x, y, pixel) in image.enumerate_pixels() {
        let [red, green, blue, alpha] = pixel.0;
        let alpha = u16::from(alpha);
        let inverse_alpha = 255_u16.saturating_sub(alpha);
        let blend = |channel: u8| -> u8 {
            (((u16::from(channel) * alpha) + (255 * inverse_alpha) + 127) / 255) as u8
        };
        flattened.put_pixel(x, y, Rgb([blend(red), blend(green), blend(blue)]));
    }

    Ok(ImageXObject {
        width: Px(width as usize),
        height: Px(height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: flattened.into_raw(),
        image_filter: None,
        clipping_bbox: None,
        smask: None,
    })
}

fn normalize_pdf_for_viewers(bytes: Vec<u8>) -> Result<Vec<u8>, String> {
    let mut document = lopdf::Document::load_mem(&bytes).map_err(|error| error.to_string())?;
    document.version = "1.4".to_owned();
    document.reference_table.cross_reference_type = XrefType::CrossReferenceTable;
    for key in [b"Type".as_slice(), b"W", b"Index", b"Length", b"Filter"] {
        document.trailer.remove(key);
    }
    for object in document.objects.values_mut() {
        if let Object::Stream(stream) = object {
            stream.dict.remove(b"SMask");
        }
    }

    let mut output = Vec::new();
    document
        .save_to(&mut output)
        .map_err(|error| error.to_string())?;
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use printpdf::image_crate::{
        codecs::png::PngEncoder, ColorType, ImageBuffer, ImageEncoder, Rgba,
    };

    #[test]
    fn consent_pdf_is_viewer_compatible_with_transparent_signature_png() {
        let signature = transparent_signature_png();
        let pdf = render_consent_pdf(&ConsentPdf {
            title: "Consenso Informato al Piano di Trattamento 2026",
            patient_name: "Mario Rossi",
            signed_at: "2026-06-26T16:30:00Z",
            body: "Finalita: diagnosi, cura odontoiatrica e gestione fiscale.\n[ ] Acconsento al trattamento dei dati sanitari.",
            signature_png: &signature,
        })
        .expect("render consent pdf");

        assert!(pdf.starts_with(b"%PDF-1.4"));
        assert!(contains_bytes(&pdf, b"xref"));
        assert!(contains_bytes(&pdf, b"trailer"));
        assert!(!contains_bytes(&pdf, b"/Type/XRef"));
        assert!(!contains_bytes(&pdf, b"/SMask"));

        lopdf::Document::load_mem(&pdf).expect("parse generated consent pdf");
    }

    fn transparent_signature_png() -> Vec<u8> {
        let mut image = ImageBuffer::from_pixel(180, 72, Rgba([0, 0, 0, 0]));
        for x in 18..162 {
            let y = 36_i32 + (((x as f32) / 9.0).sin() * 11.0) as i32;
            for offset in -1..=1 {
                let next_y = y + offset;
                if next_y >= 0 && next_y < 72 {
                    image.put_pixel(x, next_y as u32, Rgba([7, 15, 28, 255]));
                }
            }
        }

        let mut output = Vec::new();
        PngEncoder::new(&mut output)
            .write_image(image.as_raw(), 180, 72, ColorType::Rgba8)
            .expect("encode png");
        output
    }

    fn contains_bytes(haystack: &[u8], needle: &[u8]) -> bool {
        haystack
            .windows(needle.len())
            .any(|candidate| candidate == needle)
    }
}
