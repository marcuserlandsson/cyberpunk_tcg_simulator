import { z } from 'zod'
import { deckSnapshotSchema } from './deckSchema'
import type { DeckList } from '../engine/deck'
import { ENGINE_VERSION,RULES_VERSION } from '../engine/version'
export const matchSchema=z.object({id:z.string(),createdAt:z.string(),engine:z.string(),rules:z.string(),deckA:deckSnapshotSchema,deckB:deckSnapshotSchema,notes:z.string(),deadline:z.number(),finalDeadline:z.number().optional(),phase:z.enum(['playing','finish-turn','extra-turns','ended']),finalTurns:z.number().int().min(0).max(2),games:z.array(z.object({winner:z.union([z.literal(0),z.literal(1),z.null()]),notes:z.string(),recordedAt:z.string()}))})
export type MatchRecord=z.infer<typeof matchSchema>
const PREFIX='ctcg:match:v1:'
export function newMatch(deckA:DeckList,deckB:DeckList,now=Date.now()):MatchRecord {return structuredClone({id:crypto.randomUUID(),createdAt:new Date(now).toISOString(),engine:ENGINE_VERSION,rules:RULES_VERSION,deckA,deckB,notes:'',deadline:now+50*60_000,phase:'playing',finalTurns:0,games:[]})}
export function matchScore(match:MatchRecord):[number,number] {return [match.games.filter(g=>g.winner===0).length,match.games.filter(g=>g.winner===1).length]}
export function matchWinner(match:MatchRecord):0|1|'draw'|null {const [a,b]=matchScore(match);if(a>=2)return 0;if(b>=2)return 1;if(match.phase!=='ended')return null;return a===b?'draw':a>b?0:1}
export function finalGameWinner(a:number,b:number):0|1|null {return a>=7&&b<7?0:b>=7&&a<7?1:null}
export function saveMatch(match:MatchRecord):string {try{localStorage.setItem(PREFIX+match.id,JSON.stringify(match));return ''}catch{return 'Match is held in memory. Export it before closing this tab.'}}
export function readMatches():MatchRecord[]{const result:MatchRecord[]=[];try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(PREFIX))try{result.push(matchSchema.parse(JSON.parse(localStorage.getItem(key)!)))}catch{/* preserve unreadable entry */}}}catch{}return result.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
