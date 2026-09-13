import { CONSULTANT_TOOLS } from "./tools";

const CLAUDE_MODEL = "claude-haiku-4-5-20251001"; // Default model if not config-overridden

export async function askClaude(
  systemPrompt: string, 
  messages: Array<{ role: string, content: string }>, 
  apiKey: string
): Promise<{ text: string, toolCalls: any[], tokenUsage: any }> {
  
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      system: systemPrompt,
      messages,
      tools: CONSULTANT_TOOLS,
      max_tokens: 500
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  
  let text = "";
  const toolCalls = [];
  
  for (const block of data.content) {
    if (block.type === "text") {
      text += block.text;
    } else if (block.type === "tool_use") {
      toolCalls.push({
        id: block.id,
        name: block.name,
        input: block.input
      });
    }
  }

  return {
    text: text.trim(),
    toolCalls,
    tokenUsage: data.usage
  };
}
