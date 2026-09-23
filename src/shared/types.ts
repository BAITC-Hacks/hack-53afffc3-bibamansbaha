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
export type RequestedLine = { id:string; query:string; quantity:number; unit?:string; source:string; selectedId?:string; matches:Match[]; status:'exact'|'alternative'|'clarify'|'not_found' };
export type ProposalLine = {product:Product;quantity:number;lineTotalMinor:number;requestedUnit?:string;unitConfirmed?:boolean};
export type Proposal = {id:string;version:number;hash:string;status:'draft'|'awaiting_confirmation'|'confirmed'|'committed'|'cancelled'|'expired'|'invalidated';lines:ProposalLine[];totalMinor:number;expiresAt:string;createdAt:string;excluded:string[]};
export type Cart = {lines:ProposalLine[];totalMinor:number;updatedAt:string;mode:'prototype'};
export type Message = {id:string;role:'user'|'assistant';text:string;products?:Match[];createdAt:string};
export type AppState = {messages:Message[];cart:Cart;proposal:Proposal|null;catalog:{mode:CatalogMode;count:number;fetchedAt:string|null;partial:boolean;error?:string};model:{configured:boolean;verified:boolean;reason?:string|null};csrf:string};
