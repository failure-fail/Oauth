import { z } from "zod";
import {
  mapThinkingLevel,
  openAiChatCompletionObject,
  openAiChatCompletionStream,
  openAiErrorResponse,
  OpenAiCompatError,
  optionsResponse,
  requireFailureBearer,
  runOpenAiChat,
  corsHeaders,
  type OpenAiChatRequest,
} from "@/lib/openai-compat";

export const dynamic = "force-dynamic";

const messageSchema = z.object({
  role: z.string().min(1),
  content: z
    .union([
      z.string(),
      z.array(
        z.object({
          type: z.string().optional(),
          text: z.string().optional(),
          image_url: z
            .union([
              z.string(),
              z.object({
                url: z.string().min(1),
                detail: z.enum(["auto", "low", "high"]).optional(),
              }),
            ])
            .optional(),
        }),
      ),
      z.null(),
    ])
    .optional(),
  name: z.string().optional(),
});

const chatSchema = z.object({
  model: z.string().min(1),
  messages: z.array(messageSchema).min(1),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  max_tokens: z.number().optional(),
  reasoning_effort: z.string().optional(),
  thinking: z
    .union([
      z.string(),
      z.object({
        type: z.string().optional(),
        budget_tokens: z.number().optional(),
      }),
    ])
    .optional(),
});

export async function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: Request) {
  try {
    const { userId } = await requireFailureBearer(req);
    let json: unknown;
    try {
      json = await req.json();
    } catch {
      throw new OpenAiCompatError(400, "Request body must be JSON");
    }
    const parsed = chatSchema.safeParse(json);
    if (!parsed.success) {
      throw new OpenAiCompatError(
        400,
        parsed.error.issues[0]?.message || "Invalid chat.completions body",
      );
    }
    const body = parsed.data as OpenAiChatRequest;
    const providerHint = req.headers.get("x-failure-provider");
    const result = await runOpenAiChat({
      userId,
      model: body.model,
      messages: body.messages,
      providerHint,
      thinkingLevel: mapThinkingLevel(body),
    });

    if (body.stream) {
      return openAiChatCompletionStream({
        modelRef: result.modelRef,
        text: result.text,
      });
    }

    const payload = openAiChatCompletionObject({
      modelRef: result.modelRef,
      text: result.text,
    });
    return Response.json(
      result.warning
        ? { ...payload, failure_warning: result.warning }
        : payload,
      { headers: corsHeaders() },
    );
  } catch (error) {
    return openAiErrorResponse(error);
  }
}
