// ユーザーの「次の一手」= AI 判定への逃げ道（上書き）。型のみを client-safe な場所に
// 置く（feedbackWriter.ts は @google-cloud/firestore を import するので "use client" の
// InboxApp からは触れない。型だけここで共有する）。
export type UserDecision = "reported" | "marked_safe";
