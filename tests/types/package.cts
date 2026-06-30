import { Agent } from 'undici'
import { CookieJar } from 'tough-cookie'
import {
  CookieAgent,
  cookie,
  createCookieAgent,
  type CookieAgentOptions,
} from '@exhumer/undici-cookie-agent'

const jar = new CookieJar()
const options: CookieAgentOptions = { cookies: { jar } }

const agent: Agent = new CookieAgent(options)
const interceptor = cookie(options)
const CookieWrappedAgent = createCookieAgent(Agent)
const wrappedAgent: Agent = new CookieWrappedAgent(options)

void agent
void interceptor
void wrappedAgent
