/**
 *  make/offer/Offer.ts — an offer for a client, made with the offer template.
 *
 *  The offer template is a Google Sheet: per component group a row (wanden, dak, keuken), and the
 *  prices builders published to it (its tab BOUWERSPRIJZEN), per builder and scenario. It is opened
 *  with cloudcalc, live: what a builder publishes is in the next offer. An offer fills the rows with
 *  the model's quantities and computes the template:
 *
 *      offer = make.offer(OFFER_TEMPLATE)
 *      offer.add('hsbwand', { oppervlak: 48 }).add('dak', { oppervlak: 40 })
 *      offer.add('hsbwand', walls)              // or shapes that are a mass of it, by their volume
 *      wb = offer.compute({ bouwer: 'URBUILD', scenario: 'DIY Bouwpakket' })
 *      offer.outputs()                         // the template's outputs: bouwkosten, specificaties, ...
 *      offer.outputs({ scenario: 'Full Service' })   // another scenario, the offer unchanged
 *      offer.page('offerte', { titel: 'Offerte Jansen' })   // the offer as a page of the documents
 *      offer.scenarios(); offer.scenarioTable('scenarios')  // every scenario side by side
 *      wb.cloudcopy({ title: 'Offerte Jansen', share: 'writer' })   // the client's copy
 *
 *  The reckoning is ProductManager's (fromOffer(), offer()); this is its face for scripts.
 */

import type { ProductManager, OfferOptions, OfferScenarios, ProductQuantities } from '../products/ProductManager';
import type { OfferPageOptions } from '../products/offer-html';
import type { Table } from '../../calc/Table';

export class Offer
{
    /** @param engine - a ProductManager made fromOffer(template) */
    constructor(private readonly engine: ProductManager) {}

    /**
     *  A component of the template in a quantity of its unit: `add('hsbwand', { oppervlak: 48 })`,
     *  `add('keuken', { st: 1 })`; or shapes that are a mass of it, by their volume:
     *  `add('hsbwand', walls, { label: 'wanden' })`, converted at the builder's price per m3.
     *  Adding the same component again adds up.
     */
    add(component: string, quantities: ProductQuantities | any, options: { label?: string } = {}): this
    {
        const isShape = (s: any) => s && (typeof s.volume === 'function' || typeof s.toArray === 'function');
        if (Array.isArray(quantities) || isShape(quantities))
        {
            const flat = (s: any): Array<any> => (Array.isArray(s) ? s.flatMap(flat) : typeof s?.toArray === 'function' ? s.toArray().flatMap(flat) : [s]);
            flat(quantities).filter(s => typeof s?.volume === 'function').forEach(shape =>
            {
                const volume = Math.abs(Number(shape.volume()));
                if (volume > 0) { this.engine.place(shape, { component, volume, label: options.label }); }
            });
            return this;
        }
        this.engine.add(component, quantities, options);
        return this;
    }

    /**
     *  Compute the template with the quantities, at the prices one builder published to it.
     *  @param options - bouwer (default the template's first), scenario, more inputs by name.
     *  @returns the template's workbook, computed: `.cloudcopy()` makes the client's copy
     */
    compute(options: OfferOptions = {}): any
    {
        return this.engine.offer(options);
    }

    /** The outputs of the last compute(); with inputs (a scenario), of those, without changing the offer */
    outputs(inputs: Record<string, unknown> = {}): Record<string, any>
    {
        return this.engine.offerOutputs(inputs);
    }

    /** The last compute() as an HTML page */
    html(options: OfferPageOptions = {}): string
    {
        return this.engine.offerHtml(options);
    }

    /** The last compute() as a page of the documents (a table named `name`) */
    page(name: string = 'offer', options: OfferPageOptions = {}): Table
    {
        return this.engine.offerPage(name, options);
    }

    /** The last compute() in every scenario of the template */
    scenarios(options: { scenarios?: Array<string> } = {}): OfferScenarios
    {
        return this.engine.offerScenarios(options);
    }

    /** scenarios() as a table */
    scenarioTable(name: string = 'scenarios', options: { scenarios?: Array<string> } = {}): Table
    {
        return this.engine.scenarioTable(name, options);
    }
}
