import { assertEquals } from 'jsr:@std/assert@1';
import { boundedPrivateNoteCandidate, exactPrintedNoteFact } from './note-read.ts';
import { independentLabelReadsAgree } from './independent-label-read.ts';

Deno.test('private note reads retain the bounded source crop',()=>{
  const candidate={text:'PROVIDE METAL FLASHING AT ALL EXTERIOR OPENINGS',bounds:{x:.2,y:.3,width:.09,height:.02}};
  assertEquals(boundedPrivateNoteCandidate(candidate),true);
  for(const box of [{...candidate.bounds,width:.9},{...candidate.bounds,height:.4},
    {...candidate.bounds,x:NaN},{...candidate.bounds,x:true},{...candidate.bounds,x:.98}]) {
    assertEquals(boundedPrivateNoteCandidate({...candidate,bounds:box}),false);
  }
  assertEquals(boundedPrivateNoteCandidate({...candidate,text:'FLASHING'}),false);
});

Deno.test('literal note formatting cannot substitute for blind independent agreement',()=>{
  const original='PROVIDE METAL FLASHING AT ALL EXTERIOR OPENINGS';
  const read={statement:original,evidenceText:original,confidence:.99,tileIndex:0,localBounds:{x:0,y:0,width:1000,height:1000}};
  assertEquals(exactPrintedNoteFact(read,'PROVIDE METAL FLASHING\nAT ALL OPENINGS'),true);
  assertEquals(independentLabelReadsAgree(read,{...read}),true);
  for(const text of ['DO NOT PROVIDE METAL FLASHING AT ALL EXTERIOR OPENINGS',
    'PROVIDE METAL FLASHING AT SOME EXTERIOR OPENINGS','PROVIDE 6 INCH METAL FLASHING']) {
    assertEquals(independentLabelReadsAgree(read,{...read,statement:text,evidenceText:text}),false);
  }
  assertEquals(exactPrintedNoteFact({...read,statement:original+' is compliant'},original),false);
});
