/**
 * 
 *  DbBuilder.ts
 *  
 *  Archiyou has a database of materials and products to give context and meaning to modeling.
 *  Use this class to build it programmatically.
 *  
 *  Some aspects:
 *    - We use Google Gemini to get data from web sources and structure it into our database schema
 *    - We have defined JSON schemas for validation and consistency in archiyou-core/schemas
 *    - The database is stored as JSON files in archiyou-core/db/data
 *    - We can read/write the data to a google sheets document for easy editing and collaboration
 * 
 */

import path from 'path';
import fs from 'fs';

import { GoogleGenAI, GenerateContentResponse } from "@google/genai";
import { JSONSchema7 } from 'json-schema';
import { Ajv } from 'ajv';

export class DbBuilder 
{
    //// SETTINGS ////
    DB_PATH = './lib/archiyou-core/db/'; // main directory of the database - NOTE: from root directory

    //// ATTRIBUTES ////
    _path: string
    _apiKey: string
    _gemini: GoogleGenAI
    _geminiValid: boolean = false


    constructor(apiKey?: string)
    {
        this._path = this._checkDbPath();

        if(!apiKey || typeof apiKey !== 'string') 
        {
            throw new Error('Gemini API key is required to use DbBuilder');
        }
        this._apiKey = apiKey;
        this._gemini = new GoogleGenAI({ apiKey: this._apiKey });

        this._checkApiKey()
            .then(valid => { 
                    this._geminiValid = valid; 
                    console.info(`📚 DbBuilder initialized with DB path: "${this._path}" and Gemini connection!`); 
                })
            .catch(() => {
                this._geminiValid = false;
                console.error(`📚 DbBuilder failed connecting to Gemini"`);
            });
    }

    /** Send prompt to Gemini API */
    async prompt(prompt:string):Promise<GenerateContentResponse>
    {
        const startTime = performance.now() ;

        console.log(`📚 DbBuilder sending prompt to Gemini: "${prompt.substring(0, 50)}..."`);

        const response = await this._gemini.models.generateContent(
        {
            model: "gemini-2.5-flash-lite",
            contents: prompt,
        });
        const endTime = performance.now();
        console.info(`📚 DbBuilder prompt took ${endTime - startTime}ms`);

        return response;
    }

    /** Build the database */
    build(overwrite: boolean = false)
    {

    }

    async _buildMaterials(overwrite: boolean = false)
    {
        const materialSchema = this._getSchema('material');
        const baseMaterialsByCategory = this._getMaterialsInCategories();

        try {
            const response = await this.prompt(`Please generate detailed data for the following 
            construction materials in JSON format : "${JSON.stringify(baseMaterialsByCategory)}". 
            Use all properties from the following schema: ${JSON.stringify(materialSchema)}, while filling in the name and group (=material category) from the JSON.
            Fill in only one numeric value, no ranges and without units. Make sure all data is in the units and standards described by the description fields of the schema.
            If you don't know the value for a property, leave it null.
            Return a JSON array of objects conforming to the schema.
            `);

            // Gemini return text may be wrapped in ```json ... ``` blocks, clean that up
            const jsonResponse  = response.text.replace(/```/g, '')
                                    .replace(/json\s*/, '')
                                    .trim();

            const materials = JSON.parse(jsonResponse as string);
            console.log(`✅ Generated ${materials.length} materials...`);
            
            // Validate materials against schema (simple check) and save to files
            const validMaterials: any[] = [];
            materials.forEach((material: any) => {
                if (this._validateData(material, materialSchema)) 
                {
                    validMaterials.push(material);
                }
            });
            console.log(`✅ Validated ${validMaterials.length} materials against schema.`);
            this._saveData('material', validMaterials, overwrite);

        }
        catch (error) {
            console.error('❌ Error generating materials:', error);
        }

        
    }

    async _buildProducts(overwrite: boolean = false)
    {

    }

    //// DATA VALIDATION AND HANDLING ////

    /** Validate data against schema */
    _validateData(data: any, schema: JSONSchema7): boolean
    {
        const ajv = new Ajv();
        const validate = ajv.compile(schema);
        const valid = validate(data);
        if (!valid) {
            console.error('❌ Data validation errors:', validate.errors);
        }
        return valid as boolean;
    }

    _saveData(type: 'material' | 'product', data: any[], overwrite: boolean = false)
    {
        const dataPath = path.join(this._path, 'data', `${type}s.json`);
        if (fs.existsSync(dataPath) && !overwrite) {
            console.warn(`⚠️ Data file for ${type}s already exists at ${dataPath}. Use overwrite=true to replace.`);
            return;
        }
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2), 'utf-8');
        console.log(`✅ Saved ${data.length} ${type}s to ${dataPath}`);
    }

    //// UTILS ////

    _checkDbPath(): string
    {

        const rawPath = this.DB_PATH;
        if (!rawPath || typeof rawPath !== 'string') {
            throw new Error('DB_PATH is not set or is not a string.');
        }

        // Resolve relative paths against the current working directory
        const resolvedPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(process.cwd(), rawPath);

        // Check existence and that it's a directory
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`Database path does not exist: "${resolvedPath}"`);
        }
        const stat = fs.statSync(resolvedPath);
        if (!stat.isDirectory()) {
            throw new Error(`Database path is not a directory: "${resolvedPath}"`);
        }

        return resolvedPath;
    }

    /** Test if the API key is valid */
    async _checkApiKey(): Promise<boolean>
    {
        try 
        {
            const result = await this.prompt('Test');
            // If we get here without an error, the API key is valid
            return true;
        } 
        catch (error: any) 
        {
            // Check for specific authentication errors
            if (error?.message?.includes('API_KEY_INVALID') || 
                error?.message?.includes('invalid API key') ||
                error?.status === 401) 
            {
                console.error('❌ Invalid Gemini API key');
                return false;
            }
            
            // Other errors might be network issues, not invalid key
            console.warn('⚠️ Error testing API key:', error?.message);
            return false;
        }
    }

    /** Get JSON schema from file in DB_PATH/schemas/.. */
    _getSchema(schemaName: 'material' | 'product'): JSONSchema7
    {
        const schemaPath = path.join(this.DB_PATH, 'schemas', `${schemaName}.schema.json`);
        if (!fs.existsSync(schemaPath)) {
            throw new Error(`Schema file not found: ${schemaPath}`);
        }
        const schema = fs.readFileSync(schemaPath, 'utf-8');
        return JSON.parse(schema) as JSONSchema7;
    }

    _dataExists(type: 'material' | 'product'): boolean
    {
        const dataPath = path.join(this.DB_PATH, 'data', `${type}s.json`);
        return fs.existsSync(dataPath);
    }

    //// DATA ////
    

    _getMaterialsInCategories():Record<'aggregates' | 'metals' | 'masonry' | 'wood' | 'plastics' | 'insulation' | 'roofing' | 'glass', Array<{name:string, description:string}>>
    {
        return {
        "aggregates": [
            { name: "concrete", description: "A composite material made from aggregate, cement, and water." },
            { name: "cement", description: "The binding agent in concrete and mortar." },
            { name: "sand", description: "A fine aggregate used in concrete, mortar, and plaster." },
            { name: "gravel", description: "A coarse aggregate essential for concrete mixes." },
            { name: "stone", description: "Another form of coarse aggregate for concrete." },
            { name: "mortar", description: "A workable paste used to bind building blocks such as bricks and stones." },
            { name: "grout", description: "A dense fluid used to fill gaps or as reinforcement in existing structures." },
        ],
          "metals": [
            { name: "steel", description: "Steel sections like I-beams, H-beams, and channels used for framing." },
            { name: "rebar", description: "Steel bars used to reinforce concrete." },
            { name: "aluminum", description: "A lightweight and corrosion-resistant metal used for window frames, roofing, and cladding." },
            { name: "copper", description: "Used for wiring, plumbing, and roofing due to its conductivity and durability." },
            { name: "iron", description: "A primary component of steel, also used in various other forms." },
            { name: "lead", description: "Used for roofing, flashing, and radiation shielding." },
            { name: "zinc", description: "Primarily used for galvanizing steel to protect it from corrosion." },
            { name: "wire", description: "Used in cranes, elevators, and bridges." },
          ],
          "masonry": [
            { name: "bricks", description: "A fundamental building material known for its durability and fire resistance." },
            { name: "blocks", description: "Concrete Masonry Units are larger than bricks and are commonly used for walls." },
            { name: "stone", description: "A natural and durable material used for foundations, walls, and flooring." },
            { name: "granite", description: "A hard, igneous rock used for countertops, flooring, and cladding." },
            { name: "marble", description: "A metamorphic rock prized for its aesthetic appeal in flooring and decorative elements." },
            { name: "limestone", description: "A sedimentary rock used for flooring, walls, and facades." },
            { name: "sandstone", description: "A sedimentary rock used for building and paving." },
            { name: "slate", description: "A fine-grained metamorphic rock used for roofing, flooring, and countertops." },
            { name: "glass blocks", description: "Used to create walls and windows that allow light to pass through." },
            { name: "terracotta", description: "Fired clay used for roofing, cladding, and decorative elements." }
          ],
          "wood": [
            { name: "softwood", description: "Soft construction wood, typically used for framing and structural applications." },
            { name: "hardwood", description: "Denser wood, typically from deciduous trees." },
            { name: "douglas", description: "Douglas fir is a softwood species known for its strength and versatility and can be applied in exterior and interior applications." },
            { name: "plywood", description: "A sheet material made from layers of wood veneer glued together." },
            { name: "osb", description: "An engineered wood panel made from compressed layers of wood strands." },
            { name: "glulam", description: "A structural engineered wood product made by bonding together individual pieces of lumber." },
            { name: "clt", description: "Large-scale, prefabricated, solid engineered wood panels." },
            { name: "bamboo", description: "A fast-growing grass with wood-like properties, used for flooring, scaffolding, and structural elements." },
            { name: "fiberboard", description: "A type of engineered wood made from wood fibers." }
          ],
          "plastics": [
            { name: "pvc", description: "Used for pipes, window frames, flooring, and roofing membranes." },
            { name: "hdpe", description: "Used for pipes, geomembranes, and plastic lumber." },
            { name: "eps", description: "A rigid foam insulation material." },
            { name: "xps", description: "Another type of foam insulation with high compressive strength." },
            { name: "polyurethane", description: "Used in foams for insulation and as a component in coatings and adhesives." },
            { name: "polycarbonate", description: "A strong, transparent thermoplastic used for roofing, skylights, and windows." },
            { name: "acrylic", description: "A transparent thermoplastic often used as a shatter-resistant alternative to glass." },
            { name: "epdm", description: "A synthetic rubber used for roofing membranes." }
          ],
          "insulation": [
            { name: "fiberglass", description: "A common insulation material made from fine glass fibers." },
            { name: "mineralwool", description: "Insulation made from rock, slag, or glass." },
            { name: "cellulose", description: "Insulation made from recycled paper products." },
            { name: "woodfiber", description: "Insulation made from wood fibers" },
            { name: "cork", description: "A natural insulation material made from the bark of cork oak trees." },
            { name: "straw", description: "Used as an eco-friendly insulation material." },
            { name: "sprayfoam", description: "A type of insulation that is sprayed in place and then expands." },
            { name: "drywall", description: "A panel made of gypsum plaster pressed between two thick sheets of paper, used for interior walls and ceilings." },
            { name: "plaster", description: "A building material used for the protective or decorative coating of walls and ceilings." },
            { name: "stucco", description: "A material made of aggregates, a binder, and water, applied wet and hardens to a very dense solid." },
            { name: "paint", description: "Used for protecting and decorating surfaces." },
            { name: "varnish", description: "A transparent, hard, protective finish or film." },
            { name: "ceramic tiles", description: "Thin slabs of fired clay used for flooring, walls, and countertops." },
            { name: "porcelain tiles", description: "A type of ceramic tile known for its strength and water resistance." },
            { name: "terrazzo", description: "A composite material of chips of marble, quartz, granite, or glass, poured with a cementitious or polymeric binder." },
            { name: "vinyl flooring", description: "A synthetic flooring material known for its durability and water resistance." },
            { name: "linoleum", description: "A flooring material made from renewable materials like linseed oil, cork dust, and pine resin." },
            { name: "carpet", description: "A soft floor covering made from woven fibers." }
          ],
          "roofing": [
            { name: "asphalt", description: "The most common roofing material for residential buildings in North America." },
            { name: "sheeting", description: "Roofing made from metal panels or tiles, known for its durability." },
            { name: "tiles", description: "Durable and fire-resistant roofing tiles." },
            { name: "slating", description: "A premium roofing material known for its longevity and natural beauty." },
            { name: "bitumen", description: "A black, viscous mixture of hydrocarbons used for roofing and waterproofing." },
            { name: "membrane", description: "Layers of material that prevent water from penetrating a structure." }
          ],
          "glass": [
            { name: "float", description: "The most common type of glass, produced by floating molten glass on a bed of molten tin." },
            { name: "tempered", description: "Safety glass that is stronger than float glass and shatters into small, less harmful pieces." },
            { name: "laminated", description: "Safety glass made with a layer of plastic between two or more layers of glass." },
            { name: "insulated", description: "Double or triple-pane glass units that improve thermal performance." },
            { name: "low-e", description: "Glass with a special coating that reflects infrared radiation, improving energy efficiency." }
          ],
            
        };

    }
}
