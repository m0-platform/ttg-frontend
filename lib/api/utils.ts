import {
  bytesToHex,
  encodeAbiParameters,
  fromHex,
  Hash,
  keccak256,
  PublicClient,
  pad,
  stringToBytes,
  toBytes,
  toHex,
  trim,
} from 'viem'

export function removeSelectorFromCallData(callData: Hash) {
  return bytesToHex(fromHex(callData, 'bytes').slice(4))
}

export function addressToHexWith32Bytes(data: string) {
  return pad(data as Hash, {
    dir: 'left',
    size: 32,
  })
}

export function hexWith32BytesToAddress(data: Hash) {
  return trim(data)
}

export function hexWith32BytesToString(hex: string): string {
  return fromHex(hex as Hash, { size: 32, to: 'string' })
}

export function stringToHexWith32Bytes(data: string) {
  return toHex(stringToBytes(data, { size: 32 }))
}

export function generateKeyEarnerClaimant(address: Hash) {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }],
      [
        bytesToHex(toBytes('wm_claim_override_recipient', { size: 32 })),
        address,
      ],
    ),
  )
}

const RANGE_LIMIT_REGEX = /exceeds limit of (\d+)/
// ponytail: fixed concurrency, add backoff if the RPC rate-limits chunked requests
const CHUNK_CONCURRENCY = 10

/** Retry getLogs in block chunks when the RPC rejects the block range. */
export function withChunkedGetLogs<T extends PublicClient>(client: T): T {
  const getLogs = client.getLogs

  client.getLogs = (async (args: any) => {
    try {
      return await getLogs(args)
    } catch (error) {
      const limit = String((error as Error)?.message).match(RANGE_LIMIT_REGEX)
      if (!limit || typeof args?.fromBlock !== 'bigint') throw error

      const step = BigInt(limit[1])
      const toBlock =
        typeof args.toBlock === 'bigint'
          ? args.toBlock
          : await client.getBlockNumber()

      const ranges: [bigint, bigint][] = []
      for (let start = args.fromBlock; start <= toBlock; start += step) {
        const end = start + step - 1n
        ranges.push([start, end < toBlock ? end : toBlock])
      }

      const logs = []
      for (let i = 0; i < ranges.length; i += CHUNK_CONCURRENCY) {
        const batch = await Promise.all(
          ranges
            .slice(i, i + CHUNK_CONCURRENCY)
            .map(([fromBlock, toBlock]) =>
              getLogs({ ...args, fromBlock, toBlock }),
            ),
        )
        logs.push(...batch.flat())
      }
      return logs
    }
  }) as T['getLogs']

  return client
}
