import { Catalog } from './catalog';
import { CartService } from './cart';
const globalRuntime=globalThis as typeof globalThis & {ektRuntime?:{catalog:Catalog;cart:CartService}};
export const runtime=globalRuntime.ektRuntime??={catalog:new Catalog(),cart:null as unknown as CartService};
if(!runtime.cart)runtime.cart=new CartService(process.env.DATABASE_PATH??'.data/ekt.sqlite',runtime.catalog);
