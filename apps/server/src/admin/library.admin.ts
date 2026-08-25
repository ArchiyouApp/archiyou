/** Administration script for library */

import { Library } from '../execution/Library';
import { ExecutionManager } from '../execution/ExecutionManager'

const lib = new Library();


//// MIGRATE ////

/*
const otherLib = await lib.connectToOtherLibrary('https://pub.archiyou.com')
const migratedScripts = await lib.migrateScriptsFromOtherLibrary(otherLib, 'archiyou', true, true);

console.info(`Migrated ${migratedScripts.length} scripts from ${otherLib.url}`);
console.info(migratedScripts.map(s => `==> ${s.name} by ${s.author} (v${s.version})`).join('\n'));
*/

// Migrate specific script

const otherLib = await lib.connectToOtherLibrary('https://pub.archiyou.com')
//console.log((await otherLib.getLatestScripts()).map(s => `${s.author}/${s.name} (v${s.version})`));
const migratedScript = await lib.migrateScriptFromOtherLibrary(otherLib, 'archiyou', 'urhousesketch', '0.11.0', false);
//console.log(migratedScript);


//// TEST SCRIPTS IN LIBRARY ////

/*
const allScripts = await lib.getAllScripts();

const executionManger = await new ExecutionManager().init();

for(let s = 0; s < allScripts.length; s++)  // NOTE: execute serially
{
   const script = allScripts[s];
   console.log(`Executing script: ${script.name} by ${script.author} (v${script.version})`);

   const r = await executionManger.execute({
      script: script,
      // default params
      outputs: ['default/model/glb'],
      cache: false,
   });

   if(r && r.success)
   {
     console.info(`✅ Successfully executed script: ${script.name}/${script.author} (v${script.version}): Took ${r?.data?.duration}ms`);
   }
   else
   {
      console.error(`❎ Failed to execute script: ${script.name} by ${script.author} (v${script.version}). Error: "${r.error}"`);
      console.error(r?.data.messages.filter(m => m.type === 'user'));
      // break; // stop on first error
   }
};

*/


