import { assertLocalRequest, localErrorResponse, localJson, readLocalJson, LocalApiError } from "@/server/local-security";
import { getAuthorMemoryStore } from "@/server/author-memory";
import { AUTHOR_MEMORY_ITEM_LIMIT } from "@/domain/author-memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function snapshot() {
  const items = getAuthorMemoryStore().list();
  return { items, count: items.length, enabled: items.filter((item) => item.enabled).length, limit: AUTHOR_MEMORY_ITEM_LIMIT };
}

export async function GET(request: Request) {
  try { assertLocalRequest(request); return localJson(snapshot()); }
  catch (error) { return localErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    assertLocalRequest(request, { mutation: true });
    const body = await readLocalJson(request, 16384);
    const store = getAuthorMemoryStore();
    if (body.action === "save") store.save(body.item);
    else if (body.action === "delete") store.remove(body.id);
    else if (body.action === "toggle") store.setEnabled(body.id, body.enabled);
    else throw new LocalApiError(400, "不支持的作者记忆操作。");
    return localJson(snapshot());
  } catch (error) { return localErrorResponse(error); }
}
