use std::io::Write;
use xml::attribute::Attribute;
use xml::writer::{EventWriter, Result};
use crate::collada_io::io::XmlWrite;
use crate::collada_io::util::*;

#[derive(Clone)]
pub enum TransformationElement
{
    Matrix {
        sid: String,
        matrix: Vec<f64> // 4x4 suitable for matrix composition
    },
}

#[derive(Clone)]
pub struct InstanceMaterial
{
    pub target: String,
    pub symbol: String,
}

#[derive(Clone)]
pub struct BindMaterial
{
    pub instance_materials: Vec<InstanceMaterial>
}

#[derive(Clone)]
pub enum Instance
{
    Geometry {
        url: String,
        name: Option<String>,
        sid: Option<String>,
        bind_material: Option<BindMaterial>
    }
}

#[derive(Clone)]
pub struct Node
{
    pub id: String,
    pub name: String,
    pub transformation_elements: Vec<TransformationElement>,
    pub instances: Vec<Instance>,
    // vendored (P7): upstream `Node` had no children, so only a flat node list could be
    // emitted. COLLADA 1.4.1 `<node>` is `(asset?, transform*, instance_*, node*, extra*)`,
    // so nesting is legal — and it lets the Archiyou scene graph survive the export.
    pub children: Vec<Node>,
}

#[derive(Clone)]
pub struct VisualScene
{
    pub id: String,
    pub name: String,
    pub nodes: Vec<Node>
}

#[derive(Clone)]
pub struct Scene
{
    pub visual_scenes: Vec<String>
}

impl XmlWrite for TransformationElement
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
    {
        match self
        {
            Self::Matrix {
                sid,
                matrix
            } => {
                let attributes: Vec<Attribute> = vec!{
                    Attribute {
                        name: "sid".into(),
                        value: &sid
                    },
                };
                write_vec_element(w, "matrix", &matrix, &attributes)?;
            },
        }
        Ok(())
    }
}

/// vendored (P5)
impl XmlWrite for BindMaterial
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
    {
        write_start_element(w, "bind_material", &Vec::new())?;
        write_start_element(w, "technique_common", &Vec::new())?;

        for instance_material in &self.instance_materials
        {
            let attributes: Vec<Attribute> = vec!{
                Attribute {
                    name: "symbol".into(),
                    value: &instance_material.symbol
                },
                Attribute {
                    name: "target".into(),
                    value: &instance_material.target
                }
            };
            write_start_element(w, "instance_material", &attributes)?;
            write_end_element(w, "instance_material")?;
        }

        write_end_element(w, "technique_common")?;
        write_end_element(w, "bind_material")?;
        Ok(())
    }
}

impl XmlWrite for Instance
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
    {
        match self
        {
            Self::Geometry {
                url,
                name: opt_name,
                sid: _sid,
                bind_material
            } => {
                let mut attributes = vec!{
                    Attribute {
                        name: "url".into(),
                        value: url
                    }
                };

                match opt_name
                {
                    Some(name) => {
                        attributes.push(Attribute {
                            name: "name".into(),
                            value: name
                        });
                    }, None => {

                    }
                }
                write_start_element(w, "instance_geometry", &attributes)?;
                // vendored (P5): upstream dropped bind_material on the floor
                // (`// TODO: Bind Material (fx)`), so materials could never be bound.
                if let Some(bind_material) = bind_material
                {
                    bind_material.write(w)?;
                }
                write_end_element(w, "instance_geometry")?;
            }
        }
        Ok(())
    }
}

impl XmlWrite for Node
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
    {
        let attributes: Vec<Attribute> = vec!{
            Attribute {
                name: "id".into(),
                value: &self.id
            },
            Attribute {
                name: "name".into(),
                value: &self.name
            },
            Attribute {
                name: "type".into(),
                value: "NODE"
            }
        };
        write_start_element(w, "node", &attributes)?;
        for transformation_element in &self.transformation_elements
        {
            transformation_element.write(w)?;
        }
        for instance in &self.instances
        {
            instance.write(w)?;
        }
        // vendored (P7): child nodes come after the instances, per the content model
        for child in &self.children
        {
            child.write(w)?;
        }
        write_end_element(w, "node")?;
        Ok(())
    }
}

impl XmlWrite for VisualScene
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
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
        write_start_element(w, "visual_scene", &attributes)?;
        for node in &self.nodes
        {
            node.write(w)?;
        }
        write_end_element(w, "visual_scene")?;

        Ok(())
    }
}

impl XmlWrite for Scene
{
    fn write<W>(&self, w: &mut EventWriter<W>) -> Result<()>
    where W: Write
    {
        write_start_element(w, "scene", &Vec::new())?;
        for visual_scene in &self.visual_scenes
        {
            let attributes: Vec<Attribute> = vec!{
                Attribute {
                    name: "url".into(),
                    value: &visual_scene
                }
            };
            write_start_element(w, "instance_visual_scene", &attributes)?;
            write_end_element(w, "instance_visual_scene")?;
        }
        write_end_element(w, "scene")?;
        Ok(())
    }
}
