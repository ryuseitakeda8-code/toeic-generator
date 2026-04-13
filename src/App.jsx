import React, { useEffect, useMemo, useState } from 'react';
import { saveAs } from 'file-saver';
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';

function App() {
  const [words, setWords] = useState('');
  const [partStyle, setPartStyle] = useState('Part4');
  const [cefrLevel, setCefrLevel] = useState('B2');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const [voices, setVoices] = useState([]);
  const [selectedVoiceKey, setSelectedVoiceKey] = useState('us_male');

  const VOICE_SLOTS = [
    {
      key: 'us_male',
      label: '男性1 (US)',
      lang: 'en-US',
      preferredNames: ['Microsoft David', 'Microsoft Guy', 'Google US English Male', 'David', 'Guy'],
    },
    {
      key: 'us_female',
      label: '女性1 (US)',
      lang: 'en-US',
      preferredNames: ['Microsoft Zira', 'Microsoft Aria', 'Google US English Female', 'Zira', 'Aria'],
    },
    {
      key: 'uk_male',
      label: '男性2 (UK)',
      lang: 'en-GB',
      preferredNames: ['Microsoft Ryan', 'Google UK English Male', 'Ryan'],
    },
    {
      key: 'uk_female',
      label: '女性2 (UK)',
      lang: 'en-GB',
      preferredNames: ['Microsoft Sonia', 'Microsoft Libby', 'Google UK English Female', 'Sonia', 'Libby'],
    },
  ];

  const findBestVoice = (allVoices, slot) => {
    const sameLang = allVoices.filter(
      (voice) => (voice.lang || '').toLowerCase() === slot.lang.toLowerCase()
    );

    for (const preferred of slot.preferredNames) {
      const found = sameLang.find((voice) =>
        (voice.name || '').toLowerCase().includes(preferred.toLowerCase())
      );
      if (found) return found;
    }

    return sameLang[0] || null;
  };

  const loadVoices = () => {
    const allVoices = window.speechSynthesis.getVoices();

    const fixedVoices = VOICE_SLOTS.map((slot) => {
      const matchedVoice = findBestVoice(allVoices, slot);
      return matchedVoice
        ? {
            key: slot.key,
            label: slot.label,
            voice: matchedVoice,
          }
        : null;
    }).filter(Boolean);

    setVoices(fixedVoices);

    if (fixedVoices.length > 0) {
      const exists = fixedVoices.some((v) => v.key === selectedVoiceKey);
      if (!exists) {
        setSelectedVoiceKey(fixedVoices[0].key);
      }
    }
  };

  useEffect(() => {
    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const selectedVoice = useMemo(() => {
    return voices.find((v) => v.key === selectedVoiceKey) || null;
  }, [voices, selectedVoiceKey]);

  const generateTest = async () => {
    setLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          words: words
            .split(',')
            .map((w) => w.trim())
            .filter((w) => w !== ''),
          partStyle,
          cefrLevel,
        }),
      });

      const raw = await response.text();

      if (!response.ok) {
        let message = '生成失敗';
        try {
          const err = JSON.parse(raw);
          message = err.error || message;
        } catch {
          // 既定メッセージを使用
        }

        alert(`エラー: ${response.status === 401 ? '合言葉が違います' : message}`);
        return;
      }

      const data = JSON.parse(raw);
      setResult(data);
    } catch (error) {
      console.error(error);
      alert('通信エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const playAudio = (text) => {
    if (!text) {
      alert('再生する英文がありません');
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = selectedVoice?.voice?.lang || 'en-US';
    utterance.rate = 0.9;
    utterance.pitch = 1.0;

    if (selectedVoice?.voice) {
      utterance.voice = selectedVoice.voice;
    }

    window.speechSynthesis.speak(utterance);
  };

  const stopAudio = () => {
    window.speechSynthesis.cancel();
  };

  const exportToWord = async () => {
    if (!result) {
      alert('出力する問題がありません');
      return;
    }

    const paragraphs = [
      new Paragraph({
        text: 'TOEIC風 問題ジェネレーター 出力',
        heading: HeadingLevel.TITLE,
      }),
      new Paragraph({
        children: [
          new TextRun({ text: '問題形式: ', bold: true }),
          new TextRun(partStyle),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: 'CEFR: ', bold: true }),
          new TextRun(cefrLevel),
        ],
      }),
      new Paragraph({
        children: [
          new TextRun({ text: '入力単語: ', bold: true }),
          new TextRun(words),
        ],
      }),
      new Paragraph({ text: '' }),
      new Paragraph({
        text: '完全文',
        heading: HeadingLevel.HEADING_1,
      }),
      new Paragraph(result.full_text || ''),
      new Paragraph({ text: '' }),
      new Paragraph({
        text: '問題',
        heading: HeadingLevel.HEADING_1,
      }),
    ];

    if (result.questions?.length > 0) {
      result.questions.forEach((q, idx) => {
        paragraphs.push(
          new Paragraph({
            text: `Q${idx + 1}. ${q.blanked_text || ''}`,
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            children: [new TextRun({ text: '英語の選択肢', bold: true })],
          }),
          ...(q.english_options || []).map(
            (opt, i) => new Paragraph(`${String.fromCharCode(65 + i)}. ${opt}`)
          ),
          new Paragraph({
            children: [new TextRun({ text: '日本語の選択肢', bold: true })],
          }),
          ...(q.japanese_options || []).map(
            (opt, i) => new Paragraph(`${i + 1}. ${opt}`)
          ),
          new Paragraph({ text: '' })
        );
      });
    } else {
      paragraphs.push(new Paragraph('questions がありません'));
    }

    const doc = new Document({
      sections: [
        {
          properties: {},
          children: paragraphs,
        },
      ],
    });

    const blob = await Packer.toBlob(doc);
    saveAs(blob, 'toeic_questions.docx');
  };

  return (
    <div style={{ padding: '20px', maxWidth: '760px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>TOEIC風 問題ジェネレーター</h2>

      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          placeholder="単語を入力 (例: revenue, implement)"
          value={words}
          onChange={(e) => setWords(e.target.value)}
          style={{ width: '100%', padding: '8px' }}
        />
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
        <div>
          <label>問題形式</label>
          <br />
          <select value={partStyle} onChange={(e) => setPartStyle(e.target.value)}>
            <option value="Part2">Part2</option>
            <option value="Part4">Part4</option>
            <option value="Part5">Part5</option>
          </select>
        </div>

        <div>
          <label>CEFR</label>
          <br />
          <select value={cefrLevel} onChange={(e) => setCefrLevel(e.target.value)}>
            <option value="A2">A2</option>
            <option value="B1">B1</option>
            <option value="B2">B2</option>
            <option value="C1">C1</option>
          </select>
        </div>
      </div>

      <button onClick={generateTest} disabled={loading}>
        {loading ? '生成中...' : '問題を生成'}
      </button>

      {result && (
        <div style={{ marginTop: '30px', borderTop: '1px solid #ccc', paddingTop: '20px' }}>
          <h3>完全文</h3>
          <div>{result.full_text ? result.full_text : 'full_text がありません'}</div>

          <div style={{ marginTop: '12px', marginBottom: '20px' }}>
            <h4 style={{ marginTop: 0 }}>音声</h4>

            <div style={{ marginBottom: '10px' }}>
              <label>話し手</label>
              <br />
              <select
                value={selectedVoiceKey}
                onChange={(e) => setSelectedVoiceKey(e.target.value)}
              >
                {voices.length === 0 ? (
                  <option value="">音声を読み込み中</option>
                ) : (
                  voices.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.label} - {item.voice.name} ({item.voice.lang})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <button onClick={() => playAudio(result.full_text)} disabled={!result.full_text}>
                🔊 音声を再生
              </button>
              <button onClick={stopAudio}>⏹ 停止</button>
              <button onClick={exportToWord}>📝 Wordで保存</button>
            </div>

            <p style={{ marginTop: '10px', marginBottom: 0, fontSize: '14px' }}>
              選択中の話し手:{' '}
              {selectedVoice ? `${selectedVoice.label} - ${selectedVoice.voice.name}` : '未選択'}
            </p>
          </div>

          <h3>問題</h3>
          {result.questions?.length > 0 ? (
            result.questions.map((q, idx) => (
              <div
                key={idx}
                style={{
                  marginBottom: '20px',
                }}
              >
                <p>
                  <strong>Q{idx + 1}.</strong> {q.blanked_text}
                </p>

                <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                  <div>
                    <h4>英語の選択肢</h4>
                    <ul>
                      {q.english_options?.map((opt, i) => (
                        <li key={i}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <h4>日本語の選択肢</h4>
                    <ul>
                      {q.japanese_options?.map((opt, i) => (
                        <li key={i}>{opt}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <p>questions がありません</p>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
