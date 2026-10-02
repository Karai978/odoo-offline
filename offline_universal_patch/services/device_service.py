# -*- coding: utf-8 -*-
import uuid

from odoo import fields
from odoo.exceptions import ValidationError


def get_device(env, device_uuid, create=False):
    try:
        normalized_uuid = str(uuid.UUID(str(device_uuid)))
    except (ValueError, TypeError, AttributeError):
        raise ValidationError("Invalid offline device identifier.")

    Device = env["offline.universal.device"].sudo()
    device = Device.search(
        [("user_id", "=", env.uid), ("device_uuid", "=", normalized_uuid)],
        limit=1,
    )
    if not device and create:
        device = Device.create({
            "user_id": env.uid,
            "device_uuid": normalized_uuid,
            "name": "Offline browser",
        })
    if not device or not device.active:
        raise ValidationError("This offline device is not registered for the current user.")
    device.write({"last_seen": fields.Datetime.now()})
    return device
