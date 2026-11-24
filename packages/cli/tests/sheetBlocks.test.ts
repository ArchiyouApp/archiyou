import { describe, it, expect } from 'vitest';
import { retarget } from '../src/sheetBlocks';

describe('retarget: a template row of the componenten tab moved to a new block', () =>
{
    const map = new Map([[57, 12], [48, 3], [78, 35], [79, 36]]);

    it('moves the rows of cell references, relative and absolute', () =>
    {
        expect(retarget('=$W57*$X57*(1+$T57)', map)).toBe('=$W12*$X12*(1+$T12)');
        expect(retarget('=IFERROR($Q57/$H$48,"")', map)).toBe('=IFERROR($Q12/$H$3,"")');
        expect(retarget('=SUM(Y48:Y78)', map)).toBe('=SUM(Y3:Y35)');
        expect(retarget('=IF($AM$79="","",1)', map)).toBe('=IF($AM$36="","",1)');
    });

    it('leaves names, functions, other tabs, text and values alone', () =>
    {
        expect(retarget('=INDEX(products.gwp_a1a3,MATCH($L57,products.id,0))', map)).toBe('=INDEX(products.gwp_a1a3,MATCH($L12,products.id,0))');
        expect(retarget('=VLOOKUP($M57,bewerkingen!$A:$D,4,FALSE)', map)).toBe('=VLOOKUP($M12,bewerkingen!$A:$D,4,FALSE)');
        expect(retarget('=SWITCH($V57,"m2",$Q57,"m1",$P57)', map)).toBe('=SWITCH($V12,"m2",$Q12,"m1",$P12)');
        expect(retarget('=LOG10(A57)', map)).toBe('=LOG10(A12)');
        expect(retarget('sls-38x235', map)).toBe('sls-38x235');
        expect(retarget('=A99', map)).toBe('=A99');
    });
});
