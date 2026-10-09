// A built client module as the CLI finds it on disk: one self-contained ES module whose default
// export is the factory (see defineModule in @archiyou/module-sdk)
export default function twice()
{
    return {
        setArchiyou() {},
        double(n) { return 2 * n; },
    };
}
