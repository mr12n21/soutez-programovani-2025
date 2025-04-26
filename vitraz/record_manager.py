import logging

logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger(__name__)

class RecordManager:
    def __init__(self):
        self.records = {}

    def on_create(self, record_id, data):
        if record_id in self.records:
            raise ValueError(f"Záznam s ID {record_id} již existuje!")
        selfrecords[record_id] = data
        logger.info(f"Záznam {record_id} vytvořen s daty: {data}")
        return {"message": f"Záznam {record_id} vytvořen", "data": data}

    def on_update(self, record_id, data):
        if record_id not in self.records:
            raise ValueError(f"Záznam s ID {record_id} neexistuje!")
        self.records[record_id] = data
        logger.info(f"Záznam {record_id} aktualizován s daty: {data}")
        return {"message": f"Záznam {record_id} aktualizován", "data": data}

    def on_delete(self, record_id):
        if record_id not in self.records:
            raise ValueError(f"Záznam s ID {record_id} neexistuje!")
        deleted_data = self.records.pop(record_id)
        logger.info(f"Záznam {record_id} smazán")
        return {"message": f"Záznam {record_id} smazán", "data": deleted_data}