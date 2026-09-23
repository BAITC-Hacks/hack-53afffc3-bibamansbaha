export type CatalogMode = 'live' | 'snapshot' | 'fixture';
export type Evidence = { source: string; field: string; fetchedAt: string };
export type Product = {
  id: string; sku: string; supplierSku?: string; name: string; category: string;
  priceMinor: number | null; currency: 'KZT'; unit: string | null; stock: number | null;
  warehouses: { name: string; quantity: number | null }[];
  attributes: Record<string,string>; image: string | null; url: string | null;
  certificates: {name:string;url:string}[]; evidence: Evidence[]; warnings:string[];
  minQuantity: number | null; packSize:number | null; mode: CatalogMode;
};
export type Match = { product:Product; reasons:string[]; differences:string[]; kind:'exact'|'candidate'|'alternative' };
export type RequestedLine = { id:string; query:string; quantity:number; unit?:string; rawUnit?:string;rawQuantity?:number;sourceText?:string;source:string; selectedId?:string; selection?:'auto'|'manual'|'excluded';unitConfirmed?:boolean;unitReviewKey?:string; matches:Match[]; status:'exact'|'alternative'|'clarify'|'not_found' };
export type ProposalLine = {product:Product;quantity:number;lineTotalMinor:number;requestedUnit?:string;unitConfirmed?:boolean;sourceLineIds?:string[]};
export type CartPlan = { operation:'add'|'replace'; cartRevision:number; beforeMinor:number; afterMinor:number; deltaMinor:number; addedMinor:number; repricingMinor:number; repricedLines?:{productId:string;sku:string;quantity:number;previousPriceMinor:number;newPriceMinor:number;deltaMinor:number}[]; resultLines:ProposalLine[] };
export type Proposal = {id:string;version:number;hash:string;status:'draft'|'awaiting_confirmation'|'confirmed'|'committed'|'cancelled'|'expired'|'invalidated';lines:ProposalLine[];totalMinor:number;expiresAt:string;createdAt:string;excluded:string[];contractVersion?:2;plan?:CartPlan;committedCart?:Cart};
export type Cart = {lines:ProposalLine[];totalMinor:number;updatedAt:string;mode:'prototype';revision:number};
export type Message = {id:string;role:'user'|'assistant';text:string;products?:Match[];createdAt:string};
export type AppState = {messages:Message[];cart:Cart;proposal:Proposal|null;requestedLines?:RequestedLine[];catalog:{mode:CatalogMode;count:number;fetchedAt:string|null;partial:boolean;error?:string};model:{configured:boolean;verified:boolean;reason?:string|null};csrf:string};
