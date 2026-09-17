import { exactPrintedCountFact,privatePreparationMode } from './count-read.ts';
Deno.test('printed counts require the exact label and one integer without inferred conclusions',()=>{
  for(const text of ['OCC. LOAD: 137','OCCUPANT LOAD: 91','QTY: 8']) {
    if(!exactPrintedCountFact({statement:text,evidenceText:text},text.split(':')[0]))throw Error('Valid count rejected');
  }
  for(const text of ['137','COUNT: 137','OCC. LOAD: 13O','OCC. LOAD: 137.5','OCC. LOAD: 137 people','OCC. LOAD: -137']) {
    if(exactPrintedCountFact({statement:text,evidenceText:text},'OCC! LOAD:'))throw Error('Invalid count accepted');
  }
  if(exactPrintedCountFact({statement:'OCC. LOAD: 138',evidenceText:'OCC. LOAD: 137'},'OCC. LOAD:'))throw Error('Changed statement accepted');
});
Deno.test('isolated private preparation is bound to its exact job identity',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  if(!privatePreparationMode('shadow',id)||!privatePreparationMode('shadow_refresh:'+id,id))throw Error('Private preparation rejected');
  for(const mode of ['live','shadow_refresh','shadow_refresh:other',null]) {
    if(privatePreparationMode(mode,id))throw Error('Nonprivate or wrong attempt accepted');
  }
});
