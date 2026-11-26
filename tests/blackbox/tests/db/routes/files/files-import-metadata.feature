Feature: A file imported from a url keeps the IPTC and XMP metadata it carries

  - A request authenticates as the admin. `<image_server>` stands for the url
    of a server the file starts, answering any path with the same JPEG, and
    any other `<name>` for a uuid of its own. A response cell states the keys
    it checks.
  - The JPEG carries an IPTC headline, caption and two keywords, and an XMP
    title and two subjects. The instance keeps the `iptc` and `xmp` sections
    of the metadata (FILE_METADATA_ALLOW_LIST), and imports from local
    addresses (IMPORT_IP_DENY_LIST).

  Scenario: an imported JPEG keeps its IPTC and XMP metadata until deleted
    Then these requests get these responses:
      | request                                 | response                         |
      | method: POST                            | code: 200                        |+
      | path: /files/import                     | body:                            |
      | query:                                  |   data:                          |
      |   fields: id,filename_download,metadata |     filename_download: probe.jpg |
      | payload:                                |     metadata:                    |
      |   url: <image_server>/probe.jpg         |       iptc:                      |
      |   data:                                 |         headline: Probe headline |
      |     id: <probe>                         |         caption: Probe caption   |
      |                                         |         keywords:                |
      |                                         |           - probe                |
      |                                         |           - blackbox             |
      |                                         |       xmp:                       |
      |                                         |         title: Probe title       |
      |                                         |         subject:                 |
      |                                         |           - probe                |
      |                                         |           - blackbox             |
      | method: DELETE                          | code: 204                        |+
      | path: /files                            |                                  |
      | payload:                                |                                  |
      |   - <probe>                             |                                  |
      | method: GET                             | code: 200                        |+
      | path: /files                            | body:                            |
      | query:                                  |   data: []                       |
      |   fields: id                            |                                  |
      |   filter[id][_eq]: <probe>              |                                  |
