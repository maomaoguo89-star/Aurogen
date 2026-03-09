"""消息队列管理器。"""

import asyncio

# 异步队列，支持 async get/put
inbound_queue: asyncio.Queue = asyncio.Queue(maxsize=20)
outbound_queue: asyncio.Queue = asyncio.Queue(maxsize=20)


def get_inbound_queue() -> asyncio.Queue:
    return inbound_queue


def get_outbound_queue() -> asyncio.Queue:
    return outbound_queue