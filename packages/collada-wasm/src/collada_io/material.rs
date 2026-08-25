//! vendored (P3): `library_effects` + `library_materials`.
//!
//! Written from scratch. Upstream has an `fx/` directory sketching this out, but it is not
//! declared in its `lib.rs` and does not compile (struct fields separated by `;`, a bare
//! `Option<>`), so there was nothing to salvage.
//!
//! Deliberately minimal: a `<lambert>` shader with a flat diffuse colour, which is all the
//! meshup style model can supply (meshes carry no UVs, so textures are not representable).

use std::io::Write;
use xml::attribute::Attribute;
use xml::writer::{EventWriter, Result};
use crate::collada_io::util::*;

/// A `profile_COMMON` / `lambert` effect with a flat diffuse colour.
#[derive(Clone)]
pub struct Effect
{
    pub id: String,
    /// Linear RGBA in 0..1. COLLADA `<color>` is written as four space-separated floats.
    pub diffuse: [f32; 4],
}

/// A `<material>` binding a name to an `<effect>`.
#[derive(Clone)]
pub struct Material
{
    pub id: String,
    pub name: String,
    /// Effect id WITHOUT the leading `#`.
    pub effect_id: String,
}

impl Effect
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        let attributes: Vec<Attribute> = vec!{
            Attribute {
                name: "id".into(),
                value: &self.id
            }
        };
        write_start_element(w, "effect", &attributes)?;
        write_start_element(w, "profile_COMMON", &Vec::new())?;

        let technique_attrib: Vec<Attribute> = vec!{
            Attribute {
                name: "sid".into(),
                value: "common"
            }
        };
        write_start_element(w, "technique", &technique_attrib)?;
        write_start_element(w, "lambert", &Vec::new())?;

        write_start_element(w, "diffuse", &Vec::new())?;
        let color = format!("{} {} {} {}", self.diffuse[0], self.diffuse[1], self.diffuse[2], self.diffuse[3]);
        let color_attrib: Vec<Attribute> = vec!{
            Attribute {
                name: "sid".into(),
                value: "diffuse"
            }
        };
        write_text_element(w, "color", &color, &color_attrib)?;
        write_end_element(w, "diffuse")?;

        // Alpha below 1 only takes effect in most importers when transparency is declared.
        if self.diffuse[3] < 1.0
        {
            let opaque_attrib: Vec<Attribute> = vec!{
                Attribute {
                    name: "opaque".into(),
                    value: "A_ONE"
                }
            };
            write_start_element(w, "transparent", &opaque_attrib)?;
            write_text_element(w, "color", "1 1 1 1", &Vec::new())?;
            write_end_element(w, "transparent")?;

            let transparency = self.diffuse[3].to_string();
            write_start_element(w, "transparency", &Vec::new())?;
            write_text_element(w, "float", &transparency, &Vec::new())?;
            write_end_element(w, "transparency")?;
        }

        write_end_element(w, "lambert")?;
        write_end_element(w, "technique")?;
        write_end_element(w, "profile_COMMON")?;
        write_end_element(w, "effect")?;

        Ok(())
    }
}

impl Material
{
    pub fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>
    {
        let attributes: Vec<Attribute> = vec!{
            Attribute {
                name: "id".into(),
                value: &self.id
            },
            Attribute {
                name: "name".into(),
                value: &self.name
            }
        };
        write_start_element(w, "material", &attributes)?;

        let url = "#".to_string() + &self.effect_id;
        let instance_attrib: Vec<Attribute> = vec!{
            Attribute {
                name: "url".into(),
                value: &url
            }
        };
        write_start_element(w, "instance_effect", &instance_attrib)?;
        write_end_element(w, "instance_effect")?;

        write_end_element(w, "material")?;

        Ok(())
    }
}
