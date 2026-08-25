use std::io::Write;
use xml::writer::{EventWriter, Result};

pub trait XmlWrite
{
    fn write<W: Write>(&self, w: &mut EventWriter<W>) -> Result<()>;
}
