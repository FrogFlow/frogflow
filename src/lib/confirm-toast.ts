import { toast } from "sonner";

/**
 * Замена window.confirm() тостом sonner — тот же <Toaster/> уже используется
 * в проекте для успеха/ошибки (см. __root.tsx), но подтверждения
 * (удалить/заблокировать/отменить) до сих пор шли через нативный диалог,
 * единственный, что не соответствовал остальному интерфейсу.
 *
 * confirm() был синхронным — здесь это Promise: вызывающий код должен ждать
 * ответа (`if (!(await confirmToast(msg))) return;`), а не читать булево
 * значение сразу.
 */
export function confirmToast(
  message: string,
  options?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: boolean) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    toast(message, {
      duration: 20000,
      action: {
        label: options?.confirmLabel ?? "Да",
        onClick: () => settle(true),
      },
      cancel: {
        label: options?.cancelLabel ?? "Отмена",
        onClick: () => settle(false),
      },
      onDismiss: () => settle(false),
      onAutoClose: () => settle(false),
    });
  });
}
