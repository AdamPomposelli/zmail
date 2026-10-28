import { useCallback, useRef, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { ThreadList } from '@/components/mail/thread-list';
import { ThreadView } from '@/components/mail/thread-view';
import { Overview } from '@/components/mail/overview';
import { useMailRoute, VIEW_TITLES } from '@/hooks/use-mail-route';
import { useThreadActions } from '@/hooks/use-thread-actions';
import type { ThreadItem } from '@/lib/trpc';
import type { Route } from './+types/mail';

export const meta: Route.MetaFunction = ({ params }) => [{ title: `${VIEW_TITLES[params.view as keyof typeof VIEW_TITLES] ?? 'Mail'} · ZMail` }];

export default function MailScreen() {
  const route = useMailRoute();
  const { run } = useThreadActions();
  const [selection, setSelection] = useState<string[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const items = useRef<ThreadItem[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const onItems = useCallback((next: ThreadItem[]) => {
    items.current = next;
  }, []);

  const current = () => route.threadId ?? items.current[focusIndex]?.id;
  const targets = () => (selection.length ? selection : [current()].filter((id): id is string => Boolean(id)));
  const advance = () => {
    const list = items.current;
    const index = list.findIndex((t) => t.id === route.threadId);
    const next = list[index + 1] ?? list[index - 1];
    route.update({ thread: next && index >= 0 ? next.id : null });
  };
  const act = (action: Parameters<typeof run>[0], removes = true) => {
    const ids = targets();
    if (!ids.length) return;
    if (removes && route.threadId && ids.includes(route.threadId)) advance();
    void run(action, ids);
    setSelection([]);
  };

  useHotkeys('j, down', () => {
    const next = Math.min(focusIndex + 1, items.current.length - 1);
    setFocusIndex(next);
    if (route.threadId) route.update({ thread: items.current[next]?.id ?? null }, true);
  }, { preventDefault: true }, [focusIndex, route]);
  useHotkeys('k, up', () => {
    const next = Math.max(focusIndex - 1, 0);
    setFocusIndex(next);
    if (route.threadId) route.update({ thread: items.current[next]?.id ?? null }, true);
  }, { preventDefault: true }, [focusIndex, route]);
  useHotkeys('enter, o', () => route.update({ thread: items.current[focusIndex]?.id ?? null }), { preventDefault: true }, [focusIndex, route]);
  useHotkeys('escape', () => (selection.length ? setSelection([]) : route.update({ thread: null })), { preventDefault: true }, [selection, route]);
  useHotkeys('e', () => act('archive'), { preventDefault: true }, [selection, route, focusIndex]);
  useHotkeys('shift+3, delete, backspace', () => act('trash'), { preventDefault: true }, [selection, route, focusIndex]);
  useHotkeys('shift+1', () => act('spam'), { preventDefault: true }, [selection, route, focusIndex]);
  useHotkeys('s', () => act(items.current.find((t) => t.id === current())?.starred ? 'unstar' : 'star', false), { preventDefault: true }, [selection, route, focusIndex]);
  useHotkeys('u', () => act('unread', false), { preventDefault: true }, [selection, route, focusIndex]);
  useHotkeys('x', () => {
    const id = items.current[focusIndex]?.id;
    if (id) setSelection(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
  }, { preventDefault: true }, [selection, focusIndex]);
  useHotkeys('/', (e) => (e.preventDefault(), searchRef.current?.focus()), { preventDefault: true });

  return (
    <ResizablePanelGroup direction="horizontal" autoSaveId="zmail-mail-layout">
      <ResizablePanel defaultSize={42} minSize={28} maxSize={60} className="min-w-[340px]">
        <ThreadList selection={selection} setSelection={setSelection} focusIndex={focusIndex} setFocusIndex={setFocusIndex} onItems={onItems} searchRef={searchRef} />
      </ResizablePanel>
      <ResizableHandle className="bg-border" />
      <ResizablePanel defaultSize={58} minSize={35}>
        {route.threadId ? <ThreadView key={route.threadId} threadId={route.threadId} focusMessageId={route.messageId} onClose={() => route.update({ thread: null, msg: null })} /> : <Overview />}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
