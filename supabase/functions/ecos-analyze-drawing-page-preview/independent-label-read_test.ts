import { independentLabelReadsAgree } from './independent-label-read.ts';
const fact = (text = '24\'-6"') => ({statement:text,evidenceText:text,confidence:.99,tileIndex:0,
  localBounds:{x:100,y:100,width:700,height:700}});
Deno.test('independent reads require exact digits, complete wording and matching source geometry', () => {
  if (!independentLabelReadsAgree(fact(),fact())) throw Error('Identical reads rejected');
  for (const b of [fact('24\'-8"'),fact('24\'-6" MAX'),fact('24\'-O"'),
    {...fact(),confidence:.84},{...fact(),confidence:NaN},{...fact(),tileIndex:1},
    {...fact(),localBounds:{x:900,y:900,width:50,height:50}},
    {...fact(),localBounds:undefined},{...fact(),evidenceText:'different'}]) {
    if (independentLabelReadsAgree(fact(),b)) throw Error('Disagreement accepted');
  }
});
Deno.test('independent count reads never correct agreeing OCR guesses or normalize digits', () => {
  if (!independentLabelReadsAgree(fact('COUNT: 157'),fact('COUNT: 157'))) throw Error('Count rejected');
  for (const text of ['COUNT: 15T','COUNT: 151','COUNT: 0157','COUNT: 157 people','QTY: 157']) {
    if (independentLabelReadsAgree(fact('COUNT: 157'),fact(text))) throw Error('Count changed');
  }
});
