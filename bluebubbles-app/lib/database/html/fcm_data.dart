import 'package:bluebubbles/services/services.dart';

class FCMData {
  int? id;
  String? projectID;
  String? storageBucket;
  String? apiKey;
  String? firebaseURL;
  String? clientID;
  String? applicationID;

  FCMData({
    this.id,
    this.projectID,
    this.storageBucket,
    this.apiKey,
    this.firebaseURL,
    this.clientID,
    this.applicationID,
  });

  factory FCMData.fromMap(Map<String, dynamic> json) {
    Map<String, dynamic> projectInfo = json["project_info"];
    Map<String, dynamic> client = json["client"][0];
    String clientID = client["oauth_client"][0]["client_id"];
    return FCMData(
      projectID: projectInfo["project_id"],
      storageBucket: projectInfo["storage_bucket"],
      apiKey: client["api_key"][0]["current_key"],
      firebaseURL: projectInfo["firebase_url"],
      clientID: clientID.contains("-") ? clientID.substring(0, clientID.indexOf("-")) : clientID,
      applicationID: client["client_info"]["mobilesdk_app_id"],
    );
  }

  FCMData save() {
    if (isNull) return this;
    Future.delayed(Duration.zero, () async {
      await ss.prefs.setString('projectID', projectID!);
      await ss.prefs.setString('storageBucket', storageBucket!);
      await ss.prefs.setString('apiKey', apiKey!);
      if (firebaseURL != null) await ss.prefs.setString('firebaseURL', firebaseURL!);
      await ss.prefs.setString('clientID', clientID!);
      await ss.prefs.setString('applicationID', applicationID!);
    });
    return this;
  }

  static void deleteFcmData() async {
    await ss.prefs.remove('projectID');
    await ss.prefs.remove('storageBucket');
    await ss.prefs.remove('apiKey');
    await ss.prefs.remove('firebaseURL');
    await ss.prefs.remove('clientID');
    await ss.prefs.remove('applicationID');
  }

  static FCMData getFCM() {
    return FCMData(
      projectID: ss.prefs.getString('projectID'),
      storageBucket: ss.prefs.getString('storageBucket'),
      apiKey: ss.prefs.getString('apiKey'),
      firebaseURL: ss.prefs.getString('firebaseURL'),
      clientID: ss.prefs.getString('clientID'),
      applicationID: ss.prefs.getString('applicationID'),
    );
  }

  Map<String, dynamic> toMap() => {
        "project_id": projectID,
        "storage_bucket": storageBucket,
        "api_key": apiKey,
        "firebase_url": firebaseURL,
        "client_id": clientID,
        "application_id": applicationID,
      };

  bool get isNull =>
      projectID == null ||
      storageBucket == null ||
      apiKey == null ||
      clientID == null ||
      applicationID == null;
}
