import fs from 'fs/promises';
import path from 'path';
import { Services } from '@archiyou/core/src/services/Services';
import { cwd } from 'process';

//// SETTINGS ////
// NOTE: files relative to main directory
const INPUT_FILE = './test.glb';  // Input 3D file
const OUTPUT_FILE = './converted.dae';  // Output file
const FROM_FORMAT = 'glb';
const TO_FORMAT = 'dae';
const API_URL = 'http://localhost:8090';  // Your services API URL
//// END SETTINGS ////

/** Main testing function */
async function testServicesAPI(): Promise<void> 
{
    console.log('🚀 Starting Services API Test\n');

    // Initialize Services client
    const services = new Services(API_URL, 60000); // 60 second timeout
    
    try {
        // Step 1: Test connection
        console.log('1️⃣ Testing connection...');
        const isUp = await services.isUp();

        if (!isUp) 
        {
            throw new Error(`Cannot connect to services at ${API_URL}`);
        }
        
        // Step 3: Get supported formats
        console.log('3️⃣ Getting supported formats...');
        try {
            const formats = await services.getConversionFormats();
            console.log('✅ Supported formats:');
            formats.forEach(format => {
                console.log(`   - ${format.name} (${format.ext})`);
            });

            // Check if our formats are supported
            if (!formats.some(format => format.ext === FROM_FORMAT)) {
                console.warn(`⚠️ Warning: Input format '${FROM_FORMAT}' not in supported list`);
            }
            if (!formats.some(format => format.ext === TO_FORMAT)) {
                console.warn(`⚠️ Warning: Output format '${TO_FORMAT}' not in supported list`);
            }
        } catch (error) {
            console.warn('⚠️ Could not get supported formats:', error.message);
        }
    
        // Step 4: Load input file
        console.log('4️⃣ Loading input file...');
        const { ext: inputExt, data: inputData } = await loadBinaryFile(INPUT_FILE);
        
        // Step 5: Submit conversion request
        console.log('5️⃣ Submitting conversion request...');
        console.log(`   Converting: ${FROM_FORMAT} → ${TO_FORMAT}`);
        
        const startTime = Date.now();
        const result = await services.convert(
            inputData,
            FROM_FORMAT,
            TO_FORMAT,
        );

        if (!result.success)
        {
            throw new Error(`Conversion failed: ${result.error}`);
        }

        console.log('✅ Conversion successful!');
        if (result.metadata) {
            console.log(`   Original size: ${result.metadata.originalSize} bytes`);
            console.log(`   Converted size: ${result.metadata.convertedSize} bytes`);
            console.log(`   Processing time: ${result.metadata.processingTime}ms`);
            console.log(`   Size ratio: ${(result.metadata.convertedSize / result.metadata.originalSize * 100).toFixed(1)}%`);
        }
    
        // Step 6: Save output file
        console.log('6️⃣ Saving converted file...');
        if (!result.data) {
            throw new Error('No data received from conversion');
        }
        
        await saveBinaryFile(result.data, OUTPUT_FILE);

        // Step 7: Success summary
        console.log('🎉 Test completed successfully!');
        console.log(`📊 Summary:`);
        console.log(`   Input: ${INPUT_FILE} (${inputData.byteLength} bytes)`);
        console.log(`   Output: ${OUTPUT_FILE} (${result.data.byteLength} bytes)`);
        console.log(`   Total time: ${Date.now() - startTime}ms`);

    } 
    catch (error: any) 
    {
        console.error('\n❌ Test failed:', error.message);
        
        // Additional error context
        if (error.message.includes('ECONNREFUSED')) {
            console.error('💡 Tip: Make sure the services API is running');
        } else if (error.message.includes('ENOENT')) {
            console.error('💡 Tip: Check if the input file exists');
        } else if (error.message.includes('timeout')) {
            console.error('💡 Tip: The conversion might take longer, try increasing timeout');
        }
        
        process.exit(1);
    }
}

//// UTILS ////

/** Load binary file from disk */
async function loadBinaryFile(filePath: string): Promise<{ext: string, data: ArrayBuffer}> 
{
    try {
        console.log(`📂 Loading file: ${filePath}`);
        const buffer = await fs.readFile(filePath);
        console.log(`✅ Loaded ${buffer.length} bytes`);

        const ext = path.extname(filePath).slice(1);

        return { 
            ext, 
            data: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) 
        };
    } 
    catch (error: any) 
    {
        throw new Error(`Failed to load file ${filePath}: ${error.message}`);
    }
}

/** Save binary data to disk */
async function saveBinaryFile(data: ArrayBuffer, filePath: string): Promise<void> {
    try {
        // Ensure output directory exists
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        
        const buffer = Buffer.from(data);
        await fs.writeFile(filePath, buffer);
        console.log(`✅ Saved ${buffer.length} bytes to: ${filePath}`);
    } 
    catch (error: any)
    {
        throw new Error(`Failed to save file ${filePath}: ${error.message}`);
    }
}

/** Check if input file exists */
async function checkInputFile(): Promise<void> {
    try {
        console.log(cwd())
        await fs.access(INPUT_FILE);
    } catch (error) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        console.log('💡 Please create a test file or update the INPUT_FILE path in the settings');
        
        process.exit(1);
    }
}

//// RUN TEST ////
async function main(): Promise<void> 
{
    await checkInputFile();
    await testServicesAPI();
}

main().catch(console.error);