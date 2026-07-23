import {
  corsHeaders,
  listOpenAiModels,
  openAiErrorResponse,
  optionsResponse,
  requireFailureBearer,
} from "@/lib/openai-compat";

export async function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  try {
    const { userId } = await requireFailureBearer(req);
    const payload = await listOpenAiModels(userId);
    return Response.json(payload, { headers: corsHeaders() });
  } catch (error) {
    return openAiErrorResponse(error);
  }
}
