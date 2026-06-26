use printpdf::{
    image_crate::{self, Rgb, RgbImage},
    BuiltinFont, ColorBits, ColorSpace, Image, ImageTransform, ImageXObject, Mm, PdfDocument, Px,
};
use std::io::BufWriter;

pub mod repository {}

#[derive(Debug, Clone)]
pub struct PdfParty {
    pub title: String,
    pub lines: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct PdfLine {
    pub description: String,
    pub quantity: i64,
    pub unit_price_cents: i64,
    pub total_cents: i64,
}

#[derive(Debug, Clone)]
pub struct FinancialPdf {
    pub document_title: String,
    pub document_number: String,
    pub studio: PdfParty,
    pub patient: PdfParty,
    pub logo_bytes: Option<Vec<u8>>,
    pub lines: Vec<PdfLine>,
    pub gross_total_cents: i64,
    pub discount_cents: i64,
    pub net_total_cents: i64,
}

pub fn render_financial_pdf(input: &FinancialPdf) -> Result<Vec<u8>, String> {
    let (document, page, layer) = PdfDocument::new(
        &input.document_title,
        Mm(210.0),
        Mm(297.0),
        "VeloDent Precision",
    );
    let layer = document.get_page(page).get_layer(layer);
    let font = document
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|error| error.to_string())?;
    let bold_font = document
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|error| error.to_string())?;

    let header_x = if add_logo(&layer, input.logo_bytes.as_deref())? {
        55.0
    } else {
        15.0
    };
    write_text(&layer, &bold_font, 18.0, header_x, 280.0, "VeloDent");
    write_text(&layer, &bold_font, 14.0, header_x, 268.0, &input.document_title);
    write_text(&layer, &font, 10.0, header_x, 260.0, &input.document_number);

    write_text(&layer, &bold_font, 10.0, 15.0, 246.0, &input.studio.title);
    let mut y = 239.0;
    for line in &input.studio.lines {
        write_text(&layer, &font, 9.0, 15.0, y, line);
        y -= 6.0;
    }

    write_text(&layer, &bold_font, 10.0, 115.0, 246.0, &input.patient.title);
    y = 239.0;
    for line in &input.patient.lines {
        write_text(&layer, &font, 9.0, 115.0, y, line);
        y -= 6.0;
    }

    let table_top = 205.0;
    write_text(&layer, &bold_font, 9.0, 15.0, table_top, "Prestazione");
    write_text(&layer, &bold_font, 9.0, 125.0, table_top, "Q.ta");
    write_text(&layer, &bold_font, 9.0, 145.0, table_top, "Unitario");
    write_text(&layer, &bold_font, 9.0, 172.0, table_top, "Totale");

    y = table_top - 8.0;
    for line in input.lines.iter().take(24) {
        write_text(
            &layer,
            &font,
            8.0,
            15.0,
            y,
            &truncate(&line.description, 58),
        );
        write_text(&layer, &font, 8.0, 128.0, y, &line.quantity.to_string());
        write_text(
            &layer,
            &font,
            8.0,
            145.0,
            y,
            &format_cents(line.unit_price_cents),
        );
        write_text(
            &layer,
            &font,
            8.0,
            172.0,
            y,
            &format_cents(line.total_cents),
        );
        y -= 7.0;
    }

    let totals_y = 42.0;
    write_text(&layer, &font, 10.0, 135.0, totals_y, "Lordo");
    write_text(
        &layer,
        &font,
        10.0,
        172.0,
        totals_y,
        &format_cents(input.gross_total_cents),
    );
    write_text(&layer, &font, 10.0, 135.0, totals_y - 8.0, "Sconto");
    write_text(
        &layer,
        &font,
        10.0,
        172.0,
        totals_y - 8.0,
        &format_cents(input.discount_cents),
    );
    write_text(&layer, &bold_font, 11.0, 135.0, totals_y - 17.0, "Totale");
    write_text(
        &layer,
        &bold_font,
        11.0,
        172.0,
        totals_y - 17.0,
        &format_cents(input.net_total_cents),
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

fn add_logo(layer: &printpdf::PdfLayerReference, bytes: Option<&[u8]>) -> Result<bool, String> {
    let Some(bytes) = bytes else {
        return Ok(false);
    };
    if bytes.is_empty() {
        return Ok(false);
    }

    let (logo, width, height) = flattened_logo(bytes)?;
    if width == 0 || height == 0 {
        return Ok(false);
    }

    let natural_width_mm = width as f32 * 25.4 / 300.0;
    let natural_height_mm = height as f32 * 25.4 / 300.0;
    if natural_width_mm <= 0.0 || natural_height_mm <= 0.0 {
        return Ok(false);
    }

    let max_width_mm = 34.0_f32;
    let max_height_mm = 20.0_f32;
    let scale = (max_width_mm / natural_width_mm).min(max_height_mm / natural_height_mm);
    let rendered_height_mm = natural_height_mm * scale;

    Image::from(logo).add_to_layer(
        layer.clone(),
        ImageTransform {
            translate_x: Some(Mm(15.0)),
            translate_y: Some(Mm(280.0 - rendered_height_mm)),
            scale_x: Some(scale),
            scale_y: Some(scale),
            ..Default::default()
        },
    );
    Ok(true)
}

fn flattened_logo(bytes: &[u8]) -> Result<(ImageXObject, usize, usize), String> {
    let image = image_crate::load_from_memory(bytes)
        .map_err(|error| format!("logo studio non leggibile: {error}"))?
        .to_rgba8();
    let width = image.width();
    let height = image.height();
    let mut flattened = RgbImage::new(width, height);

    for (x, y, pixel) in image.enumerate_pixels() {
        let [red, green, blue, alpha] = pixel.0;
        let alpha = u16::from(alpha);
        let inverse_alpha = 255_u16.saturating_sub(alpha);
        let blend = |channel: u8| -> u8 {
            (((u16::from(channel) * alpha) + (255 * inverse_alpha) + 127) / 255) as u8
        };
        flattened.put_pixel(x, y, Rgb([blend(red), blend(green), blend(blue)]));
    }

    Ok((
        ImageXObject {
            width: Px(width as usize),
            height: Px(height as usize),
            color_space: ColorSpace::Rgb,
            bits_per_component: ColorBits::Bit8,
            interpolate: true,
            image_data: flattened.into_raw(),
            image_filter: None,
            clipping_bbox: None,
            smask: None,
        },
        width as usize,
        height as usize,
    ))
}

fn format_cents(value: i64) -> String {
    let euros = value / 100;
    let cents = (value % 100).abs();
    format!("{euros}.{cents:02} EUR")
}

fn truncate(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_owned();
    }
    let mut output = value
        .chars()
        .take(max_chars.saturating_sub(1))
        .collect::<String>();
    output.push('.');
    output
}
