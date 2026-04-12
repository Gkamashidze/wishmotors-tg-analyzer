from aiogram.filters import Filter
from aiogram.types import Message

import config


class InTopic(Filter):
    """Passes only when a message belongs to a specific forum topic in the group."""

    def __init__(self, topic_id: int) -> None:
        self.topic_id = topic_id

    async def __call__(self, message: Message) -> bool:
        return (
            message.chat.id == config.GROUP_ID
            and message.message_thread_id == self.topic_id
        )
