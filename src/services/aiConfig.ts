import { request } from '@umijs/max';

export type OkResponse<T> = {
  success: boolean;
  data: T;
};

export type CodeAgentConfigDTO = {
  type?: string | null;
  code_agent_provider?: string | null;
  code_agent_key?: string | null;
  code_agent_model?: string | null;
  code_agent_baseurl?: string | null;
  code_agent_engine?: string | null;
};

export type LLMConfigDTO = {
  type?: string | null;
  LLM_provider?: string | null;
  LLM_key?: string | null;
  LLM_model?: string | null;
  LLM_baseurl?: string | null;
  // 自定义 Provider 的 API 协议格式：openai | anthropic
  LLM_format?: string | null;
};

export type ProviderListItem = {
  models?: string[];
  provider_type?: string;
};

export type ProviderListDTO = Record<string, ProviderListItem>;

export async function getLlmConfig() {
  return request<OkResponse<Record<string, any>>>('/api/configs/llm', {
    method: 'GET',
  });
}

export async function updateLlmConfig(body: Partial<LLMConfigDTO>) {
  return request<OkResponse<Record<string, any>>>('/api/configs/llm', {
    method: 'PUT',
    data: body,
  });
}

export async function testLlmConfig() {
  return request<OkResponse<string>>('/api/configs/llm/test', {
    method: 'GET',
    skipErrorHandler: true,
  });
}

export async function getLlmProviderList() {
  return request<OkResponse<ProviderListDTO | Record<string, any>>>('/api/configs/llm/provider-list', {
    method: 'GET',
  });
}

export async function getCodeAgentConfig() {
  return request<OkResponse<Record<string, any>>>('/api/configs/code-agent', {
    method: 'GET',
  });
}

export async function updateCodeAgentConfig(body: Partial<CodeAgentConfigDTO>) {
  return request<OkResponse<Record<string, any>>>('/api/configs/code-agent', {
    method: 'PUT',
    data: body,
  });
}

export async function getCodeAgentProviderList() {
  return request<OkResponse<ProviderListDTO | Record<string, any>>>('/api/configs/code-agent/provider-list', {
    method: 'GET',
  });
}

export async function testCodeAgentConfig() {
  return request<OkResponse<string>>('/api/configs/code-agent/test', {
    method: 'GET',
    skipErrorHandler: true,
  });
}
