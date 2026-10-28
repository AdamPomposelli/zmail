import { createTRPCClient, httpBatchLink } from '@trpc/client';
import { createTRPCContext } from '@trpc/tanstack-react-query';
import type { inferRouterInputs, inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '@zmail/engine/trpc';
import superjson from 'superjson';

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

export const createClient = () =>
  createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: '/api/trpc', transformer: superjson, maxItems: 20 })],
  });

export type Inputs = inferRouterInputs<AppRouter>;
export type Outputs = inferRouterOutputs<AppRouter>;
export type ThreadItem = Outputs['mail']['list']['items'][number];
export type Thread = Outputs['mail']['thread'];
export type Message = Thread['messages'][number];
export type Tag = Outputs['catalog']['tags'][number];
export type Business = Outputs['catalog']['businesses'][number];
export type Account = Outputs['accounts']['list'][number];
export type Rule = Outputs['rules']['list'][number];
export type Suggestion = Outputs['rules']['suggestions'][number];
export type View = NonNullable<Inputs['mail']['list']['view']>;
