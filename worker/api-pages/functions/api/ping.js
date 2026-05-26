export async function onRequest(context) {
  const { env } = context;
  const info = {
    hasDB: !!env.DB,
    envKeys: Object.keys(env || {}),
    dbType: typeof env.DB
  };
  try {
    const result = await env.DB.prepare('SELECT COUNT(*) as cnt FROM anime').first();
    info.dbTest = 'OK';
    info.animeCount = result?.cnt;
  } catch (e) {
    info.dbTest = 'FAIL';
    info.dbError = e.message;
  }
  return new Response(JSON.stringify(info), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}
