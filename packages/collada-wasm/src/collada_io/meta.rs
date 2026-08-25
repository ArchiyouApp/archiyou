use std::io::Write;
use xml::attribute::Attribute;
use xml::writer::{EventWriter, Result};
use crate::collada_io::util::*;

#[derive(Clone)]
pub struct Contributor
{
    pub author: Option<String>,
    pub author_email: Option<String>,
    pub author_website: Option<String>,
    pub authoring_tool: Option<String>,
    pub comments: Option<String>,
    pub copyright: Option<String>,
    pub source_data: Option<String>
}

#[derive(Clone)]
pub struct Unit
{
    pub name: String,
    pub meter: f64
}

#[derive(Copy, Clone)]
pub enum UpAxis
{
    XUp,
    YUp,
    ZUp
}

#[derive(Clone)]
pub struct Asset
{
    pub contributors: Vec<Contributor>,
    // vendored (P2): was `chrono::DateTime<chrono::Utc>` written with `to_rfc2822()`, which
    // is not a valid `xs:dateTime`. The caller passes an ISO-8601 string instead, which also
    // lets us drop `chrono` (its `Utc::now()` needs the js-sys wasmbind path on wasm32).
    pub created: String,
    pub keywords: Option<String>,
    pub modified: String,
    pub revision: Option<String>,
    pub subject: Option<String>,
    pub title: Option<String>,
    pub unit: Unit,
    pub up_axis: Option<UpAxis>,
}

impl Default for Unit
{
    fn default() -> Unit
    {
        Unit {
            name: "meter".to_string(),
            meter: 1.0
        }
    }
}

impl Default for UpAxis
{
    fn default() -> UpAxis
    {
        UpAxis::YUp
    }
}

impl<'a> From<UpAxis> for &'a str
{
    fn from(axis: UpAxis) -> &'a str
    {
        match axis
        {
            UpAxis::XUp => "X_UP",
            UpAxis::YUp => "Y_UP",
            UpAxis::ZUp => "Z_UP"
        }
    }
}

impl UpAxis
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        let up_axis_str: &str = (*self).into();
        write_text_element(w, "up_axis", up_axis_str, &Vec::new())?;

        Ok(())
    }
}


impl Contributor
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        write_start_element(w, "contributor", &Vec::new())?;

        match &self.author
        {
            Some(author) => {
                write_text_element(w, "author", &author, &Vec::new())?;
            }, None => {}
        }

        match &self.authoring_tool
        {
            Some(authoring_tool) => {
                write_text_element(w, "authoring_tool", &authoring_tool, &Vec::new())?;
            }, None => {}
        }

        write_end_element(w, "contributor")?;
        Ok(())
    }
}

impl Default for Contributor
{
    fn default() -> Self
    {
        Self {
            author: Some("Archiyou".to_string()),
            author_email: None,
            author_website: None,
            authoring_tool: Some("Archiyou".to_string()),
            comments: None,
            copyright: None,
            source_data: None
        }
    }
}

impl Unit
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        let meter = self.meter.to_string();
        let attributes = vec!{
            Attribute {
                // vendored (P1): upstream emitted `unit="…"`. The COLLADA attribute is
                // `name`, and importers take the model scale from this pair — with the
                // wrong attribute name the unit is silently ignored.
                name: "name".into(),
                value: &self.name
            },
            Attribute {
                name: "meter".into(),
                value: &meter
            }
        };
        write_start_element(w, "unit", &attributes)?;
        write_end_element(w, "unit")?;
        Ok(())
    }
}

impl Asset
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        write_start_element(w, "asset", &Vec::new())?;

        for contributor in &self.contributors
        {
            contributor.write(w)?;
        }

        write_text_element(w, "created", &self.created, &Vec::new())?;
        write_text_element(w, "modified", &self.modified, &Vec::new())?;

        self.unit.write(w)?;
        match &self.up_axis
        {
            Some(up_axis) => {
                up_axis.write(w)?;
            },
            None => {

            }
        }

        write_end_element(w, "asset")?;

        Ok(())
    }
}

impl Default for Asset
{
    fn default() -> Self
    {
        Self {
            contributors: vec! {
                Contributor::default()
            },
            created: "1970-01-01T00:00:00Z".to_string(),
            keywords: None,
            modified: "1970-01-01T00:00:00Z".to_string(),
            revision: None,
            subject: None,
            title: None,
            up_axis: Some(UpAxis::default()),
            unit: Unit::default()
        }
    }
}
