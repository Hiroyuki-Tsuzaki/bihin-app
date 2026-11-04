// 画面に表示する運用上の注意（社員番号は本人認証ではない）
export function EmployeeNoNotice({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`notice ${compact ? 'notice-compact' : ''}`} role="note">
      <strong>ご注意：</strong>
      社員番号の入力は「受取サイン」の代わりであり、本人確認（認証）ではありません。他人の社員番号で記録しないでください。
      {!compact && <> 記録内容は利用者本人と備品担当者にメールで通知されます。心当たりのない記録があれば備品担当者に連絡してください。</>}
    </div>
  );
}
