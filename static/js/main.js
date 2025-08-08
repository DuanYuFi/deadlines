---
---
$(function() {
  deadlineByConf = {};

  {% for conf in site.data.conferences %}
  // {{ conf.name }} {{ conf.year }}
  {% if conf.deadline[0] == "TBA" %}
  {% assign conf_id = conf.name | append: conf.year | append: '-0' | slugify %}
  $('#{{ conf_id }} .timer').html("TBA");
  $('#{{ conf_id }} .deadline-time').html("TBA");
  deadlineByConf["{{ conf_id }}"] = null;

  {% else %}
  var rawDeadlines = {{ conf.deadline | jsonify }} || [];
  if (rawDeadlines.constructor !== Array) {
    rawDeadlines = [rawDeadlines];
  }
  var parsedDeadlines = [];
  while (rawDeadlines.length > 0) {
    var rawDeadline = rawDeadlines.pop();
    // deal with year template in deadline
    year = {{ conf.year }};
    rawDeadline = rawDeadline.replace('%y', year).replace('%Y', year - 1);
    // adjust date according to deadline timezone
    {% if conf.timezone %}
    var deadline = moment.tz(rawDeadline, "{{ conf.timezone }}");
    {% else %}
    var deadline = moment.tz(rawDeadline, "Etc/GMT+12"); // Anywhere on Earth
    {% endif %}

    // post-process date
    if (deadline.minutes() === 0) {
      deadline.subtract(1, 'seconds');
    }
    if (deadline.minutes() === 59) {
      deadline.seconds(59);
    }
    parsedDeadlines.push(deadline);
  }
  // due to pop before; we need to reverse such that the i index later matches
  // the right parsed deadline
  parsedDeadlines.reverse();

  {% assign range_end = conf.deadline.size | minus: 1 %}
  {% for i in (0..range_end) %}
  {% assign conf_id = conf.name | append: conf.year | append: '-' | append: i | slugify %}
  var deadlineId = {{ i }};
  if (deadlineId < parsedDeadlines.length) {
    var confDeadline = parsedDeadlines[deadlineId];

    // render countdown timer
    if (confDeadline) {
      function make_update_countdown_fn(confDeadline) {
        return function(event) {
          diff = moment() - confDeadline
          if (diff <= 0) {
             $(this).html(event.strftime('%D days %Hh %Mm %Ss'));
          } else {
            $(this).html(confDeadline.fromNow());
          }
        }
      }
      $('#{{ conf_id }} .timer').countdown(confDeadline.toDate(), make_update_countdown_fn(confDeadline));
      // check if date has passed, add 'past' class to it
      if (moment() - confDeadline > 0) {
        $('#{{ conf_id }}').addClass('past');
      }
      $('#{{ conf_id }} .deadline-time').html(confDeadline.local().format('D MMM YYYY, h:mm:ss a'));
      deadlineByConf["{{ conf_id }}"] = confDeadline;
    }
  } else {
    // TODO: hide the conf_id ?
  }
  {% endfor %}
  {% endif %}
  {% endfor %}

  // Render user-added deadlines stored in browser (via Add page)
  (function renderUserDeadlines() {
    try {
      var storageKey = '{{ site.domain }}:custom_deadlines';
      var userDeadlines = store.get(storageKey) || [];
      if (!Array.isArray(userDeadlines)) {
        userDeadlines = [];
      }
      userDeadlines.forEach(function(entry, index) {
        var name = entry.name || 'Untitled';
        var details = entry.details || '';
        var dateTime = entry.datetime || '';
        var tags = Array.isArray(entry.tags) ? entry.tags : [];

        // Build a stable id: name + datetime + index
        var rawId = (name + '-' + dateTime + '-' + index).toLowerCase();
        var confId = rawId.replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');

        // Build DOM structure consistent with index.html markup
        var tagClasses = tags.map(function(t){ return String(t).trim(); }).join(' ');
        var $conf = $('<div>', { id: confId, class: 'conf ' + tagClasses });
        var $row = $('<div>', { class: 'row' });
        var $left = $('<div>', { class: 'col-xs-12 col-sm-6' });
        var $right = $('<div>', { class: 'col-xs-12 col-sm-6' });

        $left.append(
          $('<h2>').text(name)
        );
        var metaLeft = $('<div>', { class: 'meta' });
        if (details) metaLeft.append(document.createTextNode(details));
        $left.append(metaLeft);

        var $timer = $('<span>', { class: 'timer' });
        var $deadline = $('<div>', { class: 'deadline' });
        var $deadlineRow = $('<div>').append('Deadline: ');
        var $deadlineTime = $('<span>', { class: 'deadline-time' });
        $deadlineRow.append($deadlineTime);
        $deadline.append($deadlineRow);
        $right.append($timer).append($deadline);

        $row.append($left).append($right);
        $conf.append($row).append($('<hr>'));
        $('.conf-container').append($conf);

        // Setup countdown/timestamps
        if (!dateTime) {
          $('#' + confId + ' .timer').html('TBA');
          $('#' + confId + ' .deadline-time').html('TBA');
          deadlineByConf[confId] = null;
          return;
        }
        var confDeadline = moment(dateTime);
        if (!confDeadline.isValid()) {
          // fallback parse common "YYYY-MM-DD HH:mm" without timezone
          confDeadline = moment(dateTime + ':00');
        }
        // Normalize edge minute cases similar to server data handling
        if (confDeadline.minutes() === 0) {
          confDeadline.subtract(1, 'seconds');
        }
        if (confDeadline.minutes() === 59) {
          confDeadline.seconds(59);
        }

        function make_update_countdown_fn(cd) {
          return function(event) {
            var diff = moment() - cd;
            if (diff <= 0) {
              $(this).html(event.strftime('%D days %Hh %Mm %Ss'));
            } else {
              $(this).html(cd.fromNow());
            }
          };
        }
        $timer.countdown(confDeadline.toDate(), make_update_countdown_fn(confDeadline));
        if (moment() - confDeadline > 0) {
          $('#' + confId).addClass('past');
        }
        $('#' + confId + ' .deadline-time').html(confDeadline.local().format('D MMM YYYY, h:mm:ss a'));
        deadlineByConf[confId] = confDeadline;
      });
    } catch (e) {
      // fail silently; page should still work without user data
    }
  })();

  // Reorder list
  var today = moment();
  var confs = $('.conf').detach();
  confs.sort(function(a, b) {
    var aDeadline = deadlineByConf[a.id];
    var bDeadline = deadlineByConf[b.id];
    var aDiff = today.diff(aDeadline);
    var bDiff = today.diff(bDeadline);
    if (aDiff < 0 && bDiff > 0) {
      return -1;
    }
    if (aDiff > 0 && bDiff < 0) {
      return 1;
    }
    return bDiff - aDiff;
  });
  $('.conf-container').append(confs);

  // Set checkboxes
  var conf_type_data = {{ site.data.types | jsonify }};
  var all_tags = [];
  var toggle_status = {};
  for (var i = 0; i < conf_type_data.length; i++) {
    all_tags[i] = conf_type_data[i]['tag'];
    toggle_status[all_tags[i]] = false;
  }
  var tags = store.get('{{ site.domain }}');
  if (tags === undefined) {
    tags = all_tags;
  }
  for (var i = 0; i < tags.length; i++) {
    $('#' + tags[i] + '-checkbox').prop('checked', false);
    toggle_status[tags[i]] = false;
  }
  store.set('{{ site.domain }}', tags);

  function update_conf_list() {
    confs.each(function(i, conf) {
      var conf = $(conf);
      var show = false;
      var set_tags = [];
      for (var i = 0; i < all_tags.length; i++) {
        // if tag has been selected by user, check if the conference has it
        if(toggle_status[all_tags[i]]) {
          set_tags.push(conf.hasClass(all_tags[i]));
        }
      }
      let empty_or_all_true = arr => arr.every(Boolean);
      // show a conference if it has all user-selected tags
      // if no tag is set (= array is empty), show all entries
      show = empty_or_all_true(set_tags);
      if (show) {
        conf.show();
      } else {
        conf.hide()
      }
    });
  }
  update_conf_list();

  // Event handler on checkbox change
  $('form :checkbox').change(function(e) {
    var checked = $(this).is(':checked');
    var tag = $(this).prop('id').slice(0, -9);
    toggle_status[tag] = checked;

    if (checked == true) {
      if (tags.indexOf(tag) < 0)
        tags.push(tag);
    }
    else {
      var idx = tags.indexOf(tag);
      if (idx >= 0)
        tags.splice(idx, 1);
    }
    store.set('{{ site.domain }}', tags);
    update_conf_list();
  });
});
