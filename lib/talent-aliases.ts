// 從 name_ja / name_en 自動產 aliases，幫助短暱稱匹配
// 例：叢雲カゲツ → [叢雲, カゲツ]、Shu Yamino → [Yamino]、ラトナ・プティ → [ラトナ, プティ]

const KANJI = /[\u4e00-\u9fff]/;
const KATAKANA = /[\u30a0-\u30ff]/;
const HIRAGANA = /[\u3040-\u309f]/;

function charClass(c: string): "kanji" | "kana" | "hira" | "other" {
  if (KANJI.test(c)) return "kanji";
  if (KATAKANA.test(c)) return "kana";
  if (HIRAGANA.test(c)) return "hira";
  return "other";
}

export function generateAliases(name_ja: string | null, name_en: string | null): string[] {
  const out = new Set<string>();

  if (name_ja) {
    // 先用中點/・拆分
    const dotParts = name_ja.split(/[・·•]/).map((s) => s.trim()).filter(Boolean);
    if (dotParts.length > 1) {
      dotParts.forEach((p) => {
        if (p.length >= 2 && p !== name_ja) out.add(p);
      });
    } else {
      // 掃相鄰字元類別變化點切段
      const segs: string[] = [];
      let cur = "";
      let curCls: ReturnType<typeof charClass> | null = null;
      for (const ch of name_ja) {
        const cls = charClass(ch);
        if (curCls === null || cls === curCls || cls === "other") {
          cur += ch;
          curCls = cls;
        } else {
          if (cur) segs.push(cur);
          cur = ch;
          curCls = cls;
        }
      }
      if (cur) segs.push(cur);
      if (segs.length >= 2) {
        segs.forEach((s) => {
          if (s.length >= 2 && s !== name_ja) out.add(s);
        });
      }
    }
  }

  if (name_en) {
    const tokens = name_en.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      // 姓（最後一個 token）≥4 字才加（避開 Ren, Shu, Luca 這類過於常見的 first name）
      const lastName = tokens[tokens.length - 1];
      if (lastName && lastName.length >= 4 && lastName !== name_en) out.add(lastName);
    }
  }

  return [...out];
}
