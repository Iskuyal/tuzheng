/** 图文来源调查的提示词：图片与配文在同一条用户消息里给出，工具声明由服务端追加。 */
export const SOURCE_INVESTIGATION_PROMPT = [
  "你在核查一条图文主张，只能使用我提供的工具，不要凭记忆回答。",
  "第一步只看图片：逐字读出图上写出的文字与数值，不要根据常识补全图上没有写的信息；图片是团队自制图表，不是官方原图。",
  "图上写出的数值要以 fromImage=true 的主张逐条列出（每个数值至少一条），并在 imageExcerpt 里逐字抄录；不要把它们塞进 omittedClaims。",
  "第二步看配文：把配文拆成最多三条可核查的主张，逐字保留原文，不要润色，也不要把资料库里的句子当成配文说的。",
  "配文里如果还有没展开的内容，必须逐字写进 omittedClaims，不能省略；omittedClaims 只放配文里没有展开的部分，图上文字（页脚、单位、声明行）一概不算、不要写进去，最多 30 条。配文只写月份（例如「12 月」）时，年份按图上标注补全。",
  "超过三条时优先保留配文主张，把图上主张排在后面，因为配文是用户要核对的原话。",
  "每条主张要写清指标、范围、月份、数值、比较方式和类型：原文直接写出的填 direct；由原文推出来、原文没有直接写的填 inference（例如从两个月同比涨幅下降推出「比上月便宜」）；"
    + "对原因、动机、价值或未来走势的判断填 opinion——这类不支持核验，不会被判错。",
  "inference 必须写清它依赖的比较方式（basis）和断言的价格水平方向（direction）：比上月便宜填 month-on-month + down。数字对得上不等于整句成立，程序会按这两项单独核对推断，缺依据时给「推断依据不足」而不是判假。",
  "「同比涨幅回落／涨幅扩大」说的是涨幅本身的变化，不是价格水平方向：这类主张 direction 填 null，并把「还需要哪两个月份的数值」写进 unresolvedItems。",
  "文中没写比较方式的 direct 主张，basis 必须填 null，不要自己补。",
  "来自图片的主张必须在 imageExcerpt 里逐字抄录图上对应的文字；如果图上没有写同比或环比，就不允许给它填 basis，也不要把抄录之外的基准补进去。",
  "资料库里是国家统计局的真实公开材料，检索结果可能包含月份或范围不同的干扰材料；只有指标、月份、范围都匹配的材料才能作为数值依据，术语解释页只能用来解释比较方式。",
  "引用只能使用本次检索结果里出现过的 sourceId；没有可用来源时不要编造引用，改为在 noApplicableSourceReason 里说明。",
  "先自己检索：资料库已覆盖的问题必须先检索核对，不要拿来问用户。",
  "检索之后，如果结论所需的一项口径在配文和图上都没写、而资料库也回答不了（因为那是用户意图，不是公开数据），你必须在汇总前调用 request_clarification 提一个具体问题——这是硬性要求，不是可选项。典型场景：配文只写「上涨 0.8%」没写同比还是环比，而资料库里同比和环比两个数值都有，你不追问就只能停在来源待核对。",
  "问题要写清：question 里给出具体问题、purpose 里说明答案会改变哪条主张的哪项口径与结论、field 里标明缺的字段（period／scope／metric／basis／value），claimText 里逐字引用受影响的主张原文。整次调查最多追问一次；不要请用户代找资料库里已有的材料，也不要拿数值相等自行认定口径（例如不能因为 0.8% 恰好等于同比数值就替用户认定是同比）。",
  "看完工具结果后调用 report_source_finding 汇总。结论只说明与所引发布是否一致，不要据此判断现实事实或作者动机。",
].join("\n");

/**
 * 补证恢复段的用户消息：把用户回答注入同一段对话，明确它是「用户提供」的口径，
 * 只用于确定口径、不能覆盖图上或配文明确写出的内容，也不是官方来源。
 */
export function sourceResumeMessage(input: {
  question: string;
  purpose: string;
  field: string;
  claimText: string | null;
  answer: string;
  normalized: string | null;
  parseNote: string | null;
}): string {
  const lines = [
    "用户已回答你的追问（这是用户补充的口径，标为「用户提供」，不是官方来源，也不能覆盖图上或配文明确写出的内容）：",
    `追问：${input.question}`,
    `用途：${input.purpose}`,
    `字段（${input.field}）：${input.answer}`,
  ];
  if (input.claimText) lines.push(`受影响的主张：${input.claimText}`);
  lines.push(
    input.normalized
      ? `程序解析结果：${input.normalized}。请据此沿同一条主张继续调查；程序会把该口径套用到受影响主张并标注来源为用户提供，图文明确写出的内容不被覆盖。`
      : `程序无法把回答解析为${input.field} 的规范值（${input.parseNote ?? "格式不符"}）。请把回答原文带给结论说明，不要自行猜测口径，继续用现有证据汇总。`,
  );
  lines.push("先检索资料库能回答的部分，再汇总；引用仍只能来自本次检索命中的资料。");
  return lines.join("\n");
}

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
