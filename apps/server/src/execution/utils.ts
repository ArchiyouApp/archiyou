import Redis from "ioredis";

/** Test Redis connection with proper error handling 
 *  @param parent - The parent object containing the Redis instance or simple { host, port } object
 *  @return Promise<boolean> - Returns true if connection is successful, false otherwise
*/
export async function connectToRedis(
    where: any|{ host: string, port: number }, close: boolean = false): Promise<boolean> 
{
    const redis = (where?.redis) 
                            ? where?.redis as Redis
                            : (typeof where?.host === 'string' && typeof where?.port === 'number')
                                ? new Redis(
                                    { 
                                        host:where.host, 
                                        port:where.port, 
                                        password: undefined,
                                        maxRetriesPerRequest: null,
                                        lazyConnect: true,
                                        enableOfflineQueue: false,
                                })
                                : null;
                             // plain config

    if(!redis){ throw new Error('Utils::connectToRedis(): Redis instance is not available'); }

    try {
        console.log(`Utils::connectToRedis(): Testing Redis connection at ${redis.options.host}:${redis.options.port} ...`);
        await redis.connect();
        await redis.ping();
        console.log(`Utils::connectToRedis(): ✅ ${(where?.constructor as any)?.className || ((where?.constructor?.name !== 'Object') ? where?.constructor?.name : false) || '<<no_parent>>' } Successfully connected to Redis`);

        // close if requested
        if(close)
        {
            redis.disconnect(false);
        }

        return true;
    } 
    catch (error) 
    {        
        console.error(`ExecutionWorker: ❌ Failed to connect to Redis at ${redis.options.host}:${redis.options.port}`);
        
        if (error instanceof Error)
        {
            if (error.message.includes('ECONNREFUSED'))
            {
                console.error('ExecutionWorker: Connection refused - Redis server is not running');
                console.error('ExecutionWorker: Please start Redis server or check the connection settings');
                console.error('ExecutionWorker: You can start Redis with Docker: docker compose up -d');
            } 
            else if (error.message.includes('ENOTFOUND')) {
                console.error('ExecutionWorker: Host not found - Check the Redis hostname');
            } 
            else if (error.message.includes('auth')) {
                console.error('ExecutionWorker: Authentication failed - Check Redis password');
            } 
            else {
                console.error('ExecutionWorker: Connection error:', error.message);
            }
        }

        // cleanup
        try {
            redis.options.retryStrategy = () => null;
            redis.disconnect(false); // Force disconnect without reconnection
        } catch (quitError) {
            console.error('ExecutionWorker: Error while quitting Redis connection:', quitError.message);
            // Ignore quit errors
        }
        
        return false;
    }

   
    
}


/**
 * Simple merge of two nested objects, returns a new object without modifying originals
 * @param obj1 First object
 * @param obj2 Second object (values override obj1)
 * @returns New merged object
 */
export function mergeObjects(obj1: Record<string, any>, obj2: Record<string, any>): Record<string, any> 
{
    const result: Record<string, any> = {};

    // Copy properties from obj1
    for (const key in obj1) {
        if (obj1.hasOwnProperty(key)) {
            if (obj1[key] && typeof obj1[key] === 'object' && !Array.isArray(obj1[key])) {
                result[key] = { ...obj1[key] }; // Shallow copy for nested objects
            } else {
                result[key] = obj1[key];
            }
        }
    }

    // Merge properties from obj2
    for (const key in obj2) {
        if (obj2.hasOwnProperty(key)) {
            if (obj2[key] && typeof obj2[key] === 'object' && !Array.isArray(obj2[key])) {
                // If both have the same key and both are objects, merge them
                if (result[key] && typeof result[key] === 'object' && !Array.isArray(result[key])) {
                    result[key] = mergeObjects(result[key], obj2[key]);
                } else {
                    result[key] = { ...obj2[key] }; // Shallow copy
                }
            } else {
                result[key] = obj2[key]; // Direct assignment
            }
        }
    }

    return result;
}

 /**
 * Detects if a string is valid JSON
 * @param str The string to test
 * @returns true if the string is valid JSON, false otherwise
 */
export function isJsonString(str: string): boolean 
{
    if (typeof str !== 'string') {
        return false;
    }
    
    // Quick check for obviously non-JSON strings
    const trimmed = str.trim();
    if (!trimmed || (
        !trimmed.startsWith('{') && 
        !trimmed.startsWith('[') && 
        !trimmed.startsWith('"') &&
        trimmed !== 'true' &&
        trimmed !== 'false' &&
        trimmed !== 'null' &&
        !(/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed))
    )) {
        return false;
    }

    try {
        JSON.parse(str);
        return true;
    } catch {
        return false;
    }
}