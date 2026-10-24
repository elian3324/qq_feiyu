// Only explicit commands can require a tool. Questions, negations and quoted material do not grant authority.
export function explicitPublish(text='') {
  if(/(?:不要|不许|别|不用).{0,8}(?:空间|说说)|怎么|如何|会不会|能不能|为什么/.test(text))return false;
  const normalized=text.replace(/[ \t]/g,'');
  const command=/(?:^|[，。！\n])(?:请|帮我|给我|现在|去|你)*(?:(?:在|往|到)(?:你|自己的|自己|你的)?(?:QQ)?空间(?:里|中|上)?)?(?:发|发表|发布|更新)[^。！\n]*/i.exec(normalized);
  return !!command&&/(?:空间|说说)/.test(command[0]);
}
export function explicitSticker(text='') {
  if(/(?:不要|不许|别|不用).{0,8}(?:表情|动图)|怎么|如何|会不会|为什么/.test(text))return false;
  return /(?:^|[，。！\n])(?:请|帮我|给我|现在|去|你)*(?:发|来|给).{0,8}(?:表情(?:包)?|动图|贴纸)/.test(text.replace(/[ \t]/g,''));
}
