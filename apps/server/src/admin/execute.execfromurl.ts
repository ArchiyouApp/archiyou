//import { OcLoader } from '../../../src/internal';
//import { OcLoader } from 'archiyou-core'

import { Runner } from '@archiyou/core/src/runner/Runner';
import { RunnerOps } from '@archiyou/core/src/runner/RunnerOps';


new Runner()
    .load()
    .then(
        (runner) => 
        {
            runner.executeUrl('https://pub.archiyou.com/archiyou/simplestep', {}, ['default/model/glb?data=false'])
           .then((r) => 
           {
                console.log('==== DONE ====')
                console.log(r.status);
                console.log(JSON.stringify(r.errors));

                //new RunnerOps().saveBlobToFile(r.outputs.pipelines.default.model.glb.data, 'fromurl_test.glb')
            });
        });




