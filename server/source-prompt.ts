/** 图文来源调查的提示词：图片与配文在同一条用户消息里给出，工具声明由服务端追加。 */
export const SOURCE_INVESTIGATION_PROMPT = [
  "你在核查一条图文主张，只能使用我提供的工具，不要凭记忆回答。",
  "第一步只看图片：逐字读出图上写出的文字与数值，不要根据常识补全图上没有写的信息；图片是团队自制图表，不是官方原图。",
  "第二步看配文：把配文拆成最多三条可核查的主张，逐字保留原文，不要润色。",
  "每条主张要写清指标、范围、月份、数值和比较方式；文中没写比较方式的，basis 必须填 null，不要自己补。",
  "来自图片的主张必须在 imageExcerpt 里逐字抄录图上对应的文字；如果图上没有写同比或环比，就不允许给它填 basis，也不要把抄录之外的基准补进去。",
  "资料库里是国家统计局的真实公开材料，检索结果可能包含月份或范围不同的干扰材料；只有指标、月份、范围都匹配的材料才能作为数值依据，术语解释页只能用来解释比较方式。",
  "引用只能使用本次检索结果里出现过的 sourceId；没有可用来源时不要编造引用，改为在 noApplicableSourceReason 里说明。",
  "缺口会影响结论、而资料库又回答不了时，可以调用 request_clarification 提一个问题，整次调查最多一次。",
  "看完工具结果后调用 report_source_finding 汇总。结论只说明与所引发布是否一致，不要据此判断现实事实或作者动机。",
].join("\n");

export const SOURCE_FINALIZE_INSTRUCTION =
  "调查预算已用尽，请立刻调用 report_source_finding 汇总目前已经拿到的证据；引用只能来自上面出现过的 sourceId，"
  + "没有适用来源时把原因写进 noApplicableSourceReason，并把还没解决的问题放进 unresolvedItems。";

/**
 * 无检索对照臂的必要说明：检索工具不可用时，模型必须说明缺少可用来源，
 * 不允许凭记忆引用资料库 ID，也不允许把记忆里的数值当成来源证据。
 */
export const SOURCE_NO_RETRIEVAL_NOTE = [
  "本次调查不提供资料库检索工具（search_source_library 不可用），你也不掌握本机资料库的内容。",
  "因此不要引用任何 sourceId，也不要把记忆里的统计数字当成来源证据。",
  "把「本次没有可用来源」写进 noApplicableSourceReason，把仍未解决的问题放进 unresolvedItems；"
  + "其余写法（主张字段、比较方式、图上抄录）与有检索时完全一致。",
].join("\n");

/** 两臂除检索工具可用性及这句必要说明外使用同一提示词。 */
export function sourceInvestigationPrompt(options: { retrieval: boolean }): string {
  return options.retrieval
    ? SOURCE_INVESTIGATION_PROMPT
    : `${SOURCE_INVESTIGATION_PROMPT}\n${SOURCE_NO_RETRIEVAL_NOTE}`;
}
