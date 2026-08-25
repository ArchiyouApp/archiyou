/**
 *
 *  API Wrapper for Archiyou services
 *
 *  - conversion between different data formats
 *  - basic energy calculations
 * 
 *  UP FOR DEPRECATION: Modules will be able to do these things client-side
 */

/** API wrapper for Archiyou services */
export class Services
{
    private _baseUrl: string;
    private _timeout: number;
    private _headers: Record<string, string>;

    private _nodeFormDataModule: any;
    private _nodeFormFetchModule: any;

    constructor(baseUrl: string, timeout: number = 30000)
    {
        if(!baseUrl)
        {
            console.warn(`Services(): baseUrl is required. This Services instance is disabled!`);
        }
        else {
            this._baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
            this._timeout = timeout;
            this._headers = {
                'Content-Type': 'application/json',
                'User-Agent': 'Archiyou-Services/1.0'
            };
        }
    }

    /** Set authentication token */
    setAuthToken(token: string): this {
        this._headers['Authorization'] = `Bearer ${token}`;
        return this;
    }

    /** Set custom headers */
    setHeaders(headers: Record<string, string>): this {
        this._headers = { ...this._headers, ...headers };
        return this;
    }

    /** If Services instance is set with baseUrl */
    ifSet():boolean
    {
        return this._baseUrl && typeof this._baseUrl === 'string' && this._baseUrl.length > 0;
    }

    /** Check if the API service is up and running */
    async isUp(): Promise<boolean> {
        try {
            await this._request<ServiceHealthResponse>('/')
            return true;
        }
        catch (error)
        {
            console.warn(`Services::isUp(): Can't reach service at ${this._baseUrl}: ${error}`);
            return false;
        }
    }

    //// CONVERSION ////

    async getConversionFormats(): Promise<Array<ServiceConvertFormat>>
    {
        const data = await this._request<{ formats: Array<ServiceConvertFormat> }>('/convert/formats');
        return data.formats;
    }

    /** Convert data from one format to another */
    async convert(data: ArrayBuffer|string, fromExt:string, toExt:string): Promise<ServiceConvertResponse>
    {
        const startTime = Date.now();

        try {
            // Send data based on type
            let response: ArrayBuffer;
            if (data instanceof ArrayBuffer)
            {
                // For binary data, send as multipart
                response = await this._uploadAndConvert(data, fromExt, toExt);
            }
            else {
                // For text data, include in JSON payload
                const fullPayload = { data: data, from_ext: fromExt, to_ext: toExt };
                response = await this._request<ArrayBuffer>('/convert', 'POST', fullPayload, 'arrayBuffer');
            }

            const r = {
                success: true,
                data: response,
                metadata: {
                    originalSize: data instanceof ArrayBuffer ? data.byteLength : data?.length,
                    convertedSize: response.byteLength,
                    processingTime: Date.now() - startTime
                }
            };

            console.info(`Services::convert(): Conversion ${fromExt} [${Math.round(r.metadata?.originalSize/1000)}kb] → ${toExt} [${Math.round(r.metadata?.convertedSize/1000)}kb] successful in ${r.metadata?.processingTime}ms`);
            return r;
        }
        catch (error: any)
        {
            return {
                success: false,
                error: error.message,
                metadata: {
                    originalSize: data instanceof ArrayBuffer ? data.byteLength : data.length,
                    convertedSize: 0,
                    processingTime: Date.now() - startTime
                }
            };
        }
    }


    /** Upload binary data for conversion - works in both Node.js and browser */
    private async _uploadAndConvert(data: ArrayBuffer, fromExt: string, toExt: string): Promise<ArrayBuffer>
    {
        if (this.isNode())
        {
            return this._uploadAndConvertNode(data, fromExt, toExt);
        } else {
            return this._uploadAndConvertBrowser(data, fromExt, toExt);
        }
    }

    private async _loadNodeModules(): Promise<any>
    {
        try {
            if (!this._nodeFormDataModule)
            {
                const FORM_DATA = 'form-data';
                this._nodeFormDataModule = (await import(FORM_DATA))?.default;
            }
            if(!this._nodeFormFetchModule)
            {
                const NODE_FETCH = 'node-fetch';
                this._nodeFormFetchModule = (await import(NODE_FETCH))?.default;
            }
        } catch (error) {
            throw new Error(`Failed to load Node.js modules 'form-data' or 'node-fetch'. Make sure they are installed. Error: ${error}`);
        }

    }

    /** Node.js multipart upload */
    private async _uploadAndConvertNode(data: ArrayBuffer, fromExt: string, toExt: string): Promise<ArrayBuffer>
    {
        console.info(`Services::_uploadAndConvertNode(): Using Node.js environment`);
        await this._loadNodeModules();

        const formData = new this._nodeFormDataModule();
        const buffer = Buffer.from(data);

        formData.append('file', buffer, {
            filename: `input.${fromExt}`,
            contentType: 'application/octet-stream'
        });
        formData.append('from_ext', fromExt);
        formData.append('to_ext', toExt);

        console.log('📤 Node.js FormData upload with node-fetch');

        const fetch = this._nodeFormFetchModule;

        const response = await fetch(`${this._baseUrl}/convert`, {
            method: 'POST',
            body: formData,
            headers: {
                ...formData.getHeaders(), // This is the key - proper headers with boundary
                ...(this._headers['Authorization'] && { 'Authorization': this._headers['Authorization'] }),
            },
        });

        if (!response.ok)
        {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return await response.arrayBuffer();
    }

    /** Browser multipart upload */
    private async _uploadAndConvertBrowser(data: ArrayBuffer, fromExt: string, toExt: string): Promise<ArrayBuffer>
    {
        const formData = new FormData();

        formData.append('file', new Blob([data], { type: 'application/octet-stream' }), `input.${fromExt}`);
        formData.append('from_ext', fromExt);
        formData.append('to_ext', toExt);

        const config: RequestInit = {
            method: 'POST',
            body: formData,
            headers: {
                // Browser: Don't set Content-Type, let browser handle multipart boundary
                ...(this._headers['Authorization'] && { 'Authorization': this._headers['Authorization'] }),
                'User-Agent': this._headers['User-Agent']
            },
            signal: AbortSignal.timeout(this._timeout),
        };

        const response = await fetch(`${this._baseUrl}/convert`, config);

        if (!response.ok)
        {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${errorText}`);
        }

        return await response.arrayBuffer();
    }

    /** Get available conversion formats */
    async getSupportedFormats(): Promise<{ input: string[], output: string[] }>
    {
        return await this._request<{ input: string[], output: string[] }>('/convert/formats');
    }


    //// ENERGY ////

    async energy(req: EnergyRequest): Promise<EnergyResult>
    {
        try {
            const response = await this._request<EnergyResult>('/energy/calculate', 'POST', req);
            return response;
        } catch (error) {
            console.error('❌ Services::energy():', error);
            throw error;
        }
    }


    //// BASE ////

    isNode(): boolean {
        return (typeof process !== 'undefined') && (process.release?.name === 'node');
    }

    /** Make HTTP request with error handling */
    private async _request<T>(
        endpoint: string,
        method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
        body?: any,
        responseType: 'json' | 'arrayBuffer' = 'json'
    ): Promise<T>
    {
        if(!this.ifSet())
        {
            console.error(`❌ Services::_request(): baseUrl is not set. This Services instance is disabled!`);
            return;
        }

        const url = `${this._baseUrl}${endpoint}`;

        const config: RequestInit = {
            method,
            headers: this._headers,
            signal: AbortSignal.timeout(this._timeout),
        };

        if (body) {
            if (body instanceof ArrayBuffer) {
                config.body = body;
                config.headers = { ...this._headers, 'Content-Type': 'application/octet-stream' };
            } else if (typeof body === 'string') {
                config.body = body;
                config.headers = { ...this._headers, 'Content-Type': 'text/plain' };
            } else {
                config.body = JSON.stringify(body);
            }
        }

        try {
            console.log(`🌐 API Request: ${method} ${url}`);

            const response = await fetch(url, config);

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }

            if (responseType === 'arrayBuffer') {
                return await response.arrayBuffer() as T;
            }

            return await response.json() as T;
        }
        catch (error: any)
        {
            console.error(`❌ API Error: ${method} ${url}`, error.message);

            if (error.name === 'AbortError') {
                throw new Error(`Request timeout after ${this._timeout}ms`);
            }

            throw error;
        }
    }
}


//// TYPES ////

export interface ServiceConvertFormat
{
    name: string;
    ext: string; // primary
    description?: string;
    importable: boolean;
    exportable: boolean;
    tool: 'assimp'|'gdal'; // TODO: more
}

export interface ServiceConvertRequest {
    data: ArrayBuffer | string;
    fromFormat: string; // extension
    toFormat: string; // extension
}

export interface ServiceConvertResponse {
    success: boolean;
    data?: ArrayBuffer;
    error?: string;
    metadata?: {
        originalSize: number;
        convertedSize: number;
        processingTime: number;
    };
}

export interface ServiceHealthResponse {
    message: string;
}

//// ENERGY TYPES ////

interface EnergyRequest
{
    location: { lng: number, lat: number };
    building_volume_m3: number;
    building_floor_area_m2: number;
    planes: Array<EnergyPlaneInput>;
}

/** Simplified EnergyPlaneInput
 *  See services API for details
 */
interface EnergyPlaneInput
{
    id: string;
    area_m2: number;
    azimuth_deg: number;
    tilt_deg: number;
    r_value?: number;
}

/** Solar and thermal results for a single building plane */
export interface EnergyPlaneResult {
  /** Plane identifier (matches EnergyPlaneInput.id) */
  id: string;

  /** Total POA irradiance on the coldest day (kWh/m²) */
  day_coldest_irradiance_kwh_m2: number;
  /** Total POA irradiance on the warmest day (kWh/m²) */
  day_warmest_irradiance_kwh_m2: number;
  /** Average daily POA irradiance over the year (kWh/m²) */
  day_avg_irradiance_kwh_m2: number;

  /** Conduction heat loss per m² of plane area on the coldest day (kWh/m²) */
  day_coldest_heat_loss_kwh_m2: number;
  /** Conduction heat loss per m² of plane area on the warmest day (kWh/m²) */
  day_warmest_heat_loss_kwh_m2: number;
  /** Average daily conduction heat loss per m² of plane area over the year (kWh/m²) */
  day_avg_heat_loss_kwh_m2: number;

  // Monthly metrics (daily average for that calendar month; coldest/warmest by monthly POA irradiance per plane)
  /** Daily-average POA irradiance during the month with lowest irradiance for this plane (kWh/m²/day) */
  month_coldest_irradiance_kwh_m2: number;
  /** Daily-average POA irradiance during the month with highest irradiance for this plane (kWh/m²/day) */
  month_warmest_irradiance_kwh_m2: number;
  /** Daily-average conduction heat loss per m² during the month with lowest irradiance for this plane (kWh/m²/day) */
  month_coldest_heat_loss_kwh_m2: number;
  /** Daily-average conduction heat loss per m² during the month with highest irradiance for this plane (kWh/m²/day) */
  month_warmest_heat_loss_kwh_m2: number;

  // Window-to-wall ratio optimisation
  /** Maximum recommended WWR (0.05–1.0 in 5% steps). Highest ratio where coldest month net energy > 0 and warmest month overheating ≤ limit. null if no valid ratio found. */
  wwr_max: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the coldest month at wwr_max, per m² of plane area (kWh/m²/day) */
  wwr_max_coldest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the warmest month at wwr_max, per m² of plane area (kWh/m²/day) */
  wwr_max_warmest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average net energy per m² in the coldest month at wwr_max: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_max_coldest_net_kwh_m2: number | null;
  /** Daily-average net energy per m² in the warmest month at wwr_max: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_max_warmest_net_kwh_m2: number | null;

  /** Minimum WWR that still achieves net passive benefit in the coldest month (0.05–1.0 in 5% steps). null if no valid ratio found. */
  wwr_min: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the coldest month at wwr_min, per m² of plane area (kWh/m²/day) */
  wwr_min_coldest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the warmest month at wwr_min, per m² of plane area (kWh/m²/day) */
  wwr_min_warmest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average net energy per m² in the coldest month at wwr_min: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_min_coldest_net_kwh_m2: number | null;
  /** Daily-average net energy per m² in the warmest month at wwr_min: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_min_warmest_net_kwh_m2: number | null;

  /** Average of wwr_min and wwr_max. null if either is null. */
  wwr_avg: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the coldest month at wwr_avg, per m² of plane area (kWh/m²/day) */
  wwr_avg_coldest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average total solar heat gain (windows + opaque wall) in the warmest month at wwr_avg, per m² of plane area (kWh/m²/day) */
  wwr_avg_warmest_solar_heat_gain_kwh_m2: number | null;
  /** Daily-average net energy per m² in the coldest month at wwr_avg: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_avg_coldest_net_kwh_m2: number | null;
  /** Daily-average net energy per m² in the warmest month at wwr_avg: (solar gain − heat loss) / plane area (kWh/m²/day) */
  wwr_avg_warmest_net_kwh_m2: number | null;
}

export interface EnergyDaySummary {
  date: string;
  avg_temp_c: number;
  min_temp_c: number;
  max_temp_c: number;
  total_ghi_kwh_m2: number;
}

export interface EnergyResult {
  epw_station: string;
  warmest_day: EnergyDaySummary;
  coldest_day: EnergyDaySummary;
  annual_avg_temp_c: number;
  planes: EnergyPlaneResult[];
  building_volume_m3: number | null;
  building_heating_demand_kwh_day: number | null;
  building_passive_gain_coldest_kwh_day: number | null;
  building_net_heating_required_kwh_day: number | null;
  building_heating_power_kw: number | null;
  building_heating_power_peak_kw: number | null;
  building_annual_heating_kwh: number | null;
  building_annual_heating_kwh_m2: number | null;
  building_energy_label: string | null;
}
