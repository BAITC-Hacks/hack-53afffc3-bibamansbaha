import type { RequestedLine } from '../shared/types';
import type { Catalog } from './catalog';
import { assertSafeText } from './privacy';

export type LineInput = Omit<RequestedLine, 'matches'|'status'|'unitReviewKey'>;
export async function matchRequestedLines(catalog:Catalog, incoming:LineInput[], previous:RequestedLine[]):Promise<RequestedLine[]> {
 const result:RequestedLine[]=[];
 for(const input of incoming){
  assertSafeText(JSON.stringify(input));
  const old=previous.find(line=>line.id===input.id);
  let matches=await catalog.search(input.query);
  const exact=matches.find(m=>m.kind==='exact');
  if(exact?.product.stock===0)matches=[...matches,...await catalog.alternatives(exact.product)];
  const selection=input.selection??(input.selectedId?'manual':old?.selection??'auto');
  const requested=matches.find(m=>m.product.id===input.selectedId);
  const selected=selection==='excluded'?undefined:selection==='manual'?requested:exact&&exact.product.stock!==0?exact:undefined;
  result.push({...input,rawUnit:old?.rawUnit??input.rawUnit??input.unit,rawQuantity:old?.rawQuantity??input.rawQuantity??input.quantity,sourceText:old?.sourceText??input.sourceText,selection,selectedId:selected?.product.id,matches,status:selected?(selected.kind==='alternative'?'alternative':'exact'):matches.length?'clarify':'not_found'});
 }
 return result;
}
