export async function GET() {
  return Response.json({
    message: 'Hello from Next.js 16 API Route in browser sandbox!',
    timestamp: new Date().toISOString(),
  });
}
